import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/database/prisma.service';
import { utcConnectionString } from '../../src/database/pg-connection';
import { IngredientService } from '../../src/ingredients/ingredient.service';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname) || !/_test$/.test(new URL(connectionString).pathname)) {
  throw Error('Explicit isolated local TEST_DATABASE_URL required');
}
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

describe.each(['uuid', 'text'] as const)('inventory with %s identity storage', storage => {
  const schema = 'ingredient_storage_' + randomUUID().replaceAll('-', '');
  const sql = new Client({ connectionString });
  const db = Object.assign(new PrismaClient({ adapter: new PrismaPg({
    connectionString: utcConnectionString(connectionString, `-c search_path=${schema}`),
  }, { schema }) }), { transactionOptions: { maxWait: 2000, timeout: 5000 } });
  const service = new IngredientService(db as PrismaService);
  const admin = storage === 'text' ? '12345' : randomUUID();
  const staff = storage === 'text' ? '12346' : randomUUID();
  const otherStaff = storage === 'text' ? '12347' : randomUUID();
  let milk: string;

  beforeAll(async () => {
    await sql.connect();
    await sql.query(`CREATE SCHEMA ${quote(schema)}`);
    await sql.query(`SET search_path TO ${quote(schema)}`);
    const directory = resolve(__dirname, '../../prisma/migrations');
    for (const name of readdirSync(directory).filter(n => /^\d+_/.test(n)).sort()) {
      await sql.query(readFileSync(resolve(directory, name, 'migration.sql'), 'utf8'));
    }
    if (storage === 'text') {
      // Reproduce the shared legacy storage only inside this isolated schema.
      const constraints = await sql.query<{ table: string; name: string; definition: string }>(`
        SELECT c.conrelid::regclass::text AS "table", c.conname AS name, pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
        WHERE n.nspname=$1 AND c.contype IN ('f','c')`, [schema]);
      for (const key of constraints.rows) await sql.query(`ALTER TABLE ${key.table} DROP CONSTRAINT ${quote(key.name)}`);
      const columns = await sql.query<{ table_name: string; column_name: string }>(`
        SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND udt_name='uuid'`, [schema]);
      for (const column of columns.rows) {
        await sql.query(`ALTER TABLE ${quote(column.table_name)} ALTER COLUMN ${quote(column.column_name)} TYPE text USING ${quote(column.column_name)}::text`);
      }
      for (const key of constraints.rows) await sql.query(`ALTER TABLE ${key.table} ADD CONSTRAINT ${quote(key.name)} ${key.definition}`);
    }
    for (const [id, role] of [[admin, 'ADMIN'], [staff, 'STAFF'], [otherStaff, 'STAFF']] as const) {
      await db.user.create({ data: { id, role, email: id + '@example.invalid', passwordHash: 'isolated-fixture-only' } });
    }
  });

  afterAll(async () => {
    await db.$disconnect();
    await sql.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
    await sql.end();
  });

  test('empty summary and catalog initialization work; repeated loads preserve identities, stock and history', async () => {
    expect(await service.summary(admin, 'ADMIN')).toEqual({ totalIngredients: 0, inStock: 0, lowStock: 0, outOfStock: 0, pendingCounts: 0 });
    expect(await service.initializeCatalog(admin)).toEqual({ created: 18, existing: 0 });
    const before = await db.ingredient.findMany({ orderBy: { id: 'asc' } });
    expect(before.every(row => row.quantity.isZero())).toBe(true);
    milk = before.find(row => row.name === 'Sữa tươi không đường (công thức)')!.id;
    expect(await service.initializeCatalog(admin)).toEqual({ created: 0, existing: 18 });
    expect(await db.ingredient.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await db.ingredientMovement.count()).toBe(0);
    expect(await service.summary(staff, 'STAFF')).toMatchObject({ totalIngredients: 18, outOfStock: 18, pendingCounts: 0 });
  });

  test('receipt confirmation changes stock exactly once and subsequent catalog loads preserve it', async () => {
    const draft = await service.createReceipt(admin, randomUUID(), { lines: [{ ingredientId: milk, quantity: '12' }] });
    expect((await db.ingredient.findUniqueOrThrow({ where: { id: milk } })).quantity.toFixed(3)).toBe('0.000');
    const confirmed = await service.confirmReceipt(admin, draft.id, 0);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', lines: [{ movement: { beforeQuantity: '0.000', afterQuantity: '12.000' } }] });
    expect(await service.confirmReceipt(admin, draft.id, 0)).toEqual(confirmed);
    const before = await db.ingredient.findUniqueOrThrow({ where: { id: milk } });
    await service.initializeCatalog(admin);
    expect(await db.ingredient.findUniqueOrThrow({ where: { id: milk } })).toEqual(before);
    expect(await db.ingredientMovement.count()).toBe(1);
  });

  test('summary respects Staff ownership; approval reconciles a new receipt and recount is replay safe', async () => {
    const before = await db.ingredient.findUniqueOrThrow({ where: { id: milk } });
    const old = await service.createCount(staff, randomUUID(), { lines: [{ ingredientId: milk, expectedVersion: before.version, actualQuantity: '11' }] });
    expect(await service.summary(admin, 'ADMIN')).toMatchObject({ pendingCounts: 1 });
    expect(await service.summary(staff, 'STAFF')).toMatchObject({ pendingCounts: 1 });
    expect(await service.summary(otherStaff, 'STAFF')).toMatchObject({ pendingCounts: 0 });
    const draft = await service.createReceipt(admin, randomUUID(), { lines: [{ ingredientId: milk, quantity: '2' }] });
    await service.confirmReceipt(admin, draft.id, 0);
    await service.reviewCount(admin, old.id, { expectedVersion: 0, action: 'APPROVE', note: '' });
    expect((await db.ingredient.findUniqueOrThrow({ where: { id: milk } })).quantity.toFixed(3)).toBe('13.000');
    const measure = await service.createCount(staff, randomUUID(), { lines: [{ ingredientId: milk, expectedVersion: (await db.ingredient.findUniqueOrThrow({where:{id:milk}})).version, actualQuantity: '12' }] });
    await service.reviewCount(admin, measure.id, { expectedVersion: 0, action: 'REQUEST_RECOUNT', note: 'Recheck actual quantity' });
    const current = await db.ingredient.findUniqueOrThrow({ where: { id: milk } });
    const fresh = await service.createCount(staff, randomUUID(), { recountOfId: measure.id, lines: [{ ingredientId: milk, expectedVersion: current.version, actualQuantity: '13' }] });
    const approved = await service.reviewCount(admin, fresh.id, { expectedVersion: 0, action: 'APPROVE', note: '' });
    expect(await service.reviewCount(admin, fresh.id, { expectedVersion: 0, action: 'APPROVE', note: '' })).toEqual(approved);
    expect((await db.ingredient.findUniqueOrThrow({ where: { id: milk } })).quantity.toFixed(3)).toBe('13.000');
    expect(await db.ingredientMovement.count()).toBe(4);
    expect(await service.summary(staff, 'STAFF')).toMatchObject({ pendingCounts: 0 });
  });
});

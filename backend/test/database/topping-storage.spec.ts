import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/database/prisma.service';
import { AdminOptionService } from '../../src/catalog/admin-option.service';
import { utcConnectionString } from '../../src/database/pg-connection';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname) || !/_test$/.test(new URL(connectionString).pathname)) throw Error('Explicit isolated local TEST_DATABASE_URL required');
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';

describe.each(['uuid', 'text'] as const)('Topping management with %s identity storage', storage => {
  const schema = 'topping_storage_' + randomUUID().replaceAll('-', '');
  const sql = new Client({ connectionString });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString, `-c search_path=${schema}`) }, { schema }) });
  const service = new AdminOptionService(db as PrismaService);
  const id = storage === 'text' ? '3' : randomUUID();
  beforeAll(async () => {
    await sql.connect(); await sql.query(`CREATE SCHEMA ${quote(schema)}`); await sql.query(`SET search_path TO ${quote(schema)}`);
    const directory = resolve(__dirname, '../../prisma/migrations');
    for (const name of readdirSync(directory).filter(n => /^\d+_/.test(n)).sort()) await sql.query(readFileSync(resolve(directory, name, 'migration.sql'), 'utf8'));
    if (storage === 'text') {
      const keys = (await sql.query<{ table: string; name: string; definition: string }>(`SELECT c.conrelid::regclass::text AS "table",c.conname AS name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype IN ('f','c')`, [schema])).rows;
      for (const key of keys) await sql.query(`ALTER TABLE ${key.table} DROP CONSTRAINT ${quote(key.name)}`);
      const columns = (await sql.query<{ table_name: string; column_name: string }>(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND udt_name='uuid'`, [schema])).rows;
      for (const column of columns) await sql.query(`ALTER TABLE ${quote(column.table_name)} ALTER COLUMN ${quote(column.column_name)} TYPE text USING ${quote(column.column_name)}::text`);
      for (const key of keys) await sql.query(`ALTER TABLE ${key.table} ADD CONSTRAINT ${quote(key.name)} ${key.definition}`);
    }
    await db.topping.create({ data: { id, name: 'Sương Sáo', price: '5000' } });
  });
  afterAll(async () => { await db.$disconnect(); await sql.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`); await sql.end(); });
  test('list/detail preserve the stored identity and metadata without modifying rows', async () => {
    const before = await db.topping.findMany();
    expect((await service.toppings()).items).toHaveLength(1);
    expect(await service.topping(id)).toMatchObject({ id, name: 'Sương Sáo', price: '5000', version: 0, isActive: true });
    expect(await db.topping.findMany()).toEqual(before);
  });
  test('missing numeric identity returns404 on both native storage types', async () => {
    await expect(service.topping('999')).rejects.toMatchObject({ status: 404 });
    await expect(service.updateTopping('999', { expectedVersion: 0, price: '0' })).rejects.toMatchObject({ status: 404 });
  });
  test('updates use the original revision; stale writes cannot overwrite the row', async () => {
    expect(await service.updateTopping(id, { expectedVersion: 0, price: '7000' })).toMatchObject({ id, price: '7000', version: 1 });
    await expect(service.updateTopping(id, { expectedVersion: 0, name: 'Stale' })).rejects.toMatchObject({ status: 409 });
    expect(await service.topping(id)).toMatchObject({ name: 'Sương Sáo', price: '7000', version: 1 });
  });
  test('concurrent updates admit one version change', async () => {
    const results = await Promise.allSettled([service.updateTopping(id, { expectedVersion: 1, price: '8000' }), service.updateTopping(id, { expectedVersion: 1, price: '9000' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ status: 409 });
    expect(await service.topping(id)).toMatchObject({ version: 2 });
  });
  test('referenced deletion stays blocked; unused UUID creation and deletion still work', async () => {
    const product = await db.product.create({ data: { name: 'Fixture', price: '0', imageUrl: '/images/fixture.svg', stock: 0 } });
    await db.productTopping.create({ data: { productId: product.id, toppingId: id } });
    const before = await db.topping.findUniqueOrThrow({ where: { id } });
    await expect(service.deleteTopping(id, before.version)).rejects.toMatchObject({ status: 409 });
    expect(await db.topping.findUniqueOrThrow({ where: { id } })).toEqual(before);
    const spare = await service.createTopping({ name: 'Unused', price: '0' });
    expect(spare.id).toMatch(/^[0-9a-f-]{36}$/);
    await service.deleteTopping(spare.id, 0); await expect(service.topping(spare.id)).rejects.toMatchObject({ status: 404 });
  });
  test('database failure rolls back metadata and version together', async () => {
    const before = await db.topping.findUniqueOrThrow({ where: { id } });
    await sql.query(`CREATE FUNCTION fail_topping() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$; CREATE TRIGGER fail_topping AFTER UPDATE ON toppings FOR EACH ROW EXECUTE FUNCTION fail_topping()`);
    try { await expect(service.updateTopping(id, { expectedVersion: before.version, name: 'Rollback' })).rejects.toMatchObject({ status: 503 }); }
    finally { await sql.query('DROP TRIGGER fail_topping ON toppings'); }
    expect(await db.topping.findUniqueOrThrow({ where: { id } })).toEqual(before);
  });
});

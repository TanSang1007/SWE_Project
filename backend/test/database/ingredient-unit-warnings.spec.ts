import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import type { PrismaService } from '../../src/database/prisma.service';
import { utcConnectionString } from '../../src/database/pg-connection';
import { IngredientService } from '../../src/ingredients/ingredient.service';
import { readIngredientCatalog } from '../../src/ingredients/ingredient-catalog';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname) || !/_test$/.test(new URL(connectionString).pathname)) throw Error('Explicit local test database required');
const schema = 'unit_warning_' + randomUUID().replaceAll('-', '');
const sql = new Client({ connectionString });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString, `-c search_path=${schema}`) }, { schema }) });
const service = new IngredientService(db as unknown as PrismaService);
const actor = randomUUID();
const migration = '20261117000000_ingredient_unit_warning_thresholds';
const dir = resolve(__dirname, '../../prisma/migrations');

beforeAll(async () => {
  await sql.connect();
  await sql.query(`CREATE SCHEMA "${schema}"`);
  await sql.query(`SET search_path TO "${schema}"`);
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n) && n < migration).sort()) await sql.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  await sql.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [actor, randomUUID()+'@example.invalid', 'isolated-fixture']);
});
afterAll(async () => {
  await db.$disconnect();
  await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await sql.end();
});

test('unit warning migration preserves inventory metadata and enforces KG/L for every name', async () => {
  const legacy = [
    ['Bột ca cao','KG','1'], ['Bột matcha','KG','0.5'], ['Bột quế','KG','0.1'], ['Cà phê','KG','3'],
    ['Đường','KG','5'], ['Sữa tươi','L','10'], ['Sữa đặc','L','3'], ['Sốt caramel','BOTTLE','1'], ['Đá','BAG','1'],
    ['Other eggs','EGG','10'], ['Other grams','G','10000'], ['Other milliliters','ML','5000'], ['Other bottle','BOTTLE','10'], ['Other bag','BAG','5'],
  ];
  const fixtures = [...legacy, ...readIngredientCatalog().map(i => [i.name, i.unit, i.unit === 'KG' ? '10' : i.unit === 'L' ? '5' : '10'])];
  for (const [name, unit, threshold] of fixtures) {
    const decimal = ['KG','L','G','ML'].includes(unit);
    await sql.query('INSERT INTO ingredients(id,name,normalized_name,unit,quantity,reserved_quantity,low_stock_threshold,version,created_by_id,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,7,$8,$9,$10)',
      [randomUUID(), name, name.toLocaleLowerCase('vi'), unit, decimal ? '12.345' : '12', decimal ? '0.345' : '0', threshold, actor, randomUUID(), 'a'.repeat(64)]);
  }
  const fingerprint = async () => (await sql.query<{ row: unknown }>("SELECT CASE WHEN unit::text IN ('KG','L') THEN to_jsonb(i)-'low_stock_threshold' ELSE to_jsonb(i) END AS row FROM ingredients i ORDER BY id")).rows;
  const before = await fingerprint();
  await sql.query(readFileSync(resolve(dir, migration, 'migration.sql'), 'utf8'));
  expect(await fingerprint()).toEqual(before);
  const rows = (await service.ingredients()).items;
  for (const row of rows.filter(i => i.unit === 'KG' || i.unit === 'L')) {
    expect(row.lowStockThreshold).toBe(row.unit === 'KG' ? '3.000' : '2.000');
    expect(row.lowStockInclusive).toBe(false);
  }
  for (const unit of ['KG','L']) {
    await expect(sql.query('UPDATE ingredients SET low_stock_threshold=99 WHERE unit::text=$1', [unit])).rejects.toMatchObject({ code: '23514', constraint: 'ingredients_unit_threshold_check' });
  }
});

test.each(['zero','below','equal','above'])('list and summary agree at %s available quantity, including reservations', async boundary => {
  for (const [unit, threshold] of [['KG',3], ['L',2]] as const) {
    const available = boundary === 'zero' ? 0 : boundary === 'below' ? threshold - 0.001 : boundary === 'equal' ? threshold : threshold + 0.001;
    await sql.query('UPDATE ingredients SET quantity=$1, reserved_quantity=1 WHERE unit::text=$2', [(available+1).toFixed(3), unit]);
  }
  const rows = (await service.ingredients()).items;
  const expected = boundary === 'zero' ? 'OUT_OF_STOCK' : boundary === 'below' ? 'LOW_STOCK' : 'IN_STOCK';
  expect(rows.filter(i => i.unit === 'KG' || i.unit === 'L').every(i => i.status === expected)).toBe(true);
  expect(await service.summary(actor, 'ADMIN')).toMatchObject({
    totalIngredients: rows.length,
    lowStock: rows.filter(i => i.status === 'LOW_STOCK').length,
    inStock: rows.filter(i => i.status === 'IN_STOCK').length,
    outOfStock: rows.filter(i => i.status === 'OUT_OF_STOCK').length,
  });
});

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { ingredientCatalog } from '../../src/ingredients/ingredient-catalog';
import { ingredientThreshold, unitThreshold } from '../../src/ingredients/ingredient-policy';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname) || !/_test$/.test(new URL(connectionString).pathname)) throw Error('Explicit local test database required');
const schema = 'warning_migration_' + randomUUID().replaceAll('-', '');
const db = new Client({ connectionString });
beforeAll(async () => { await db.connect(); await db.query(`CREATE SCHEMA "${schema}"`); await db.query(`SET search_path TO "${schema}"`); });
afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.end(); });
test('warning migration preserves every name, unit, quantity, version, timestamp and request hash', async () => {
  const name = '20261107120000_ingredient_warning_thresholds', dir = resolve(__dirname, '../../prisma/migrations');
  for (const migration of readdirSync(dir).filter(n => /^\d+_/.test(n) && n < name).sort()) await db.query(readFileSync(resolve(dir,migration,'migration.sql'),'utf8'));
  const actor = randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [actor, randomUUID()+'@example.invalid','isolated-fixture']);
  for (const item of ingredientCatalog) await db.query('INSERT INTO ingredients(id,name,normalized_name,unit,quantity,low_stock_threshold,version,created_by_id,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,7,$7,$8,$9)',
    [randomUUID(),item.name,item.name.toLocaleLowerCase('vi'),item.unit,['PIECE','BAG','BOTTLE'].includes(item.unit)?'12':'12.345',unitThreshold(item.unit).toFixed(3),actor,randomUUID(),'a'.repeat(64)]);
  const fingerprint = async () => (await db.query<{row:unknown}>("SELECT to_jsonb(i)-'low_stock_threshold' AS row FROM ingredients i ORDER BY id")).rows;
  const before = await fingerprint();
  await db.query(readFileSync(resolve(dir,name,'migration.sql'),'utf8'));
  expect(await fingerprint()).toEqual(before);
  const rows = (await db.query('SELECT name,unit::text,low_stock_threshold::text AS threshold FROM ingredients')).rows as {name:string;unit:typeof ingredientCatalog[number]['unit'];threshold:string}[];
  expect(rows).toHaveLength(14);
  for (const row of rows) expect(row.threshold).toBe(ingredientThreshold(row.name,row.unit).toFixed(3));
});

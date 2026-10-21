// Read-only PostgreSQL metadata verification; no record contents or credentials.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Client } = require('pg');
require('dotenv').config({ path: resolve(__dirname, '../../.env'), quiet: true });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const migrations = resolve(__dirname, 'migrations');
    const dirs = readdirSync(migrations).filter((name) => /^\d+_/.test(name)).sort();
    const sql = dirs.map((dir) => readFileSync(resolve(migrations, dir, 'migration.sql'), 'utf8')).join('\n');
    const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name")).rows;
    assert.deepEqual(tables.map((r) => r.table_name), [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]).sort());
    const columns = (await client.query("SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default,numeric_precision,numeric_scale,datetime_precision FROM information_schema.columns WHERE table_schema='public' AND table_name <> '_prisma_migrations' ORDER BY table_name,ordinal_position")).rows;
    const moneyColumns = columns.filter((c) => c.data_type === 'numeric');
    assert.equal(moneyColumns.length, 14);
    for (const column of moneyColumns) {
      assert.equal(column.numeric_precision, 12); assert.equal(column.numeric_scale, 0);
    }
    const constraints = (await client.query("SELECT c.conname AS name,c.contype AS type,r.relname AS table_name,pg_get_constraintdef(c.oid) AS definition,c.convalidated AS validated FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname <> '_prisma_migrations' ORDER BY r.relname,c.conname")).rows;
    const checks = constraints.filter((c) => c.type === 'c');
    assert.deepEqual(checks.map((c) => c.name).sort(), [...sql.matchAll(/CONSTRAINT "([^"]+)" CHECK/g)].map((m) => m[1]).sort());
    assert.ok(constraints.every((c) => c.validated));
    const fks = constraints.filter((c) => c.type === 'f');
    assert.equal(fks.length, (sql.match(/FOREIGN KEY/g) ?? []).length);
    assert.ok(fks.every((c) => c.definition.includes(`ON UPDATE CASCADE ON DELETE ${['cart_items_cart_id_fkey', 'cart_item_toppings_cart_item_id_fkey'].includes(c.name) ? 'CASCADE' : 'RESTRICT'}`)));
    assert.equal(constraints.filter((c) => c.type === 'p').length, tables.length);
    const indexes = (await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename,indexname")).rows;
    const expectedIndexes = [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(indexes.map((i) => i.indexname).sort(), [...expectedIndexes, ...tables.map((t) => `${t.table_name}_pkey`)].sort());
    const partial = indexes.find((i) => i.indexname === 'payments_one_success_per_order_idx');
    assert.ok(partial?.indexdef.includes('UNIQUE') && partial.indexdef.includes('SUCCEEDED'));
    const enums = (await client.query("SELECT t.typname AS type,e.enumlabel AS value,e.enumsortorder AS position FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder")).rows;
    assert.equal(new Set(enums.map((e) => e.type)).size, 5);
    const history = (await client.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows;
    assert.equal(history.length, dirs.length);
    for (const [index, dir] of dirs.entries()) {
      assert.equal(history[index].migration_name, dir);
      assert.ok(history[index].finished_at && !history[index].rolled_back_at);
      assert.equal(history[index].checksum, createHash('sha256').update(readFileSync(resolve(migrations, dir, 'migration.sql'))).digest('hex'));
    }
    const counts = {};
    for (const { table_name: name } of tables) counts[name] = (await client.query(`SELECT count(*)::int AS count FROM "${name}"`)).rows[0].count;
    assert.equal(counts.products, 2); assert.equal(counts.product_sizes, 6);
    assert.equal(counts.toppings, 2); assert.equal(counts.product_toppings, 4);
    // B04 strict clean-seed audit retained; B08 allows users and their persistent carts.
    if (!process.argv.includes('--cart')) for (const name of ['users','orders','order_items','order_item_toppings','payments','loyalty_awards','idempotency_requests','promotions']) assert.equal(counts[name], 0);
    const leftover = await client.query("SELECT nspname FROM pg_namespace WHERE nspname ~ '^brewlite_b0[4578]_test_'");
    assert.equal(leftover.rowCount, 0);
    const report = { tables, columns, constraints, indexes, enums, migrations: history, seedCounts: counts };
    if (process.argv[2]) writeFileSync(resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS: ${tables.length} tables, ${columns.length} columns, ${fks.length} FKs, ${checks.length} CHECKs, ${indexes.length} indexes, 5 enums; migration checksum/seed counts/test cleanup verified`);
  } finally { await client.end(); }
}
main().catch(() => { console.error('Database metadata verification failed; credentials suppressed'); process.exitCode = 1; });

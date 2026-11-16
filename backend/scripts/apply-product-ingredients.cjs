// Narrow, data-preserving deploy for the recipe snapshot column only.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const apply = process.argv.includes('--apply');
if (process.argv.some(a => a.startsWith('--') && !['--apply', '--check'].includes(a))) throw Error('Unsupported option');
const name = '20261107110000_product_ingredient_availability', dir = path.resolve(__dirname, '../prisma/migrations');
const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'), checksum = crypto.createHash('sha256').update(sql).digest('hex');
const target = new URL(process.env.DIRECT_URL ?? ''), runtime = new URL(process.env.DATABASE_URL ?? '');
const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
const neon = target.hostname.endsWith('.neon.tech') && target.pathname === '/brewlite_dev';
if (!['postgresql:', 'postgres:'].includes(target.protocol) || target.pathname !== runtime.pathname
  || !(local && /_(test|dev)$/.test(target.pathname) || neon && ['require', 'verify-full'].includes(target.searchParams.get('sslmode')))) throw Error('Expected authorized development database');
if (neon) target.searchParams.set('sslmode', 'verify-full');
async function fingerprint(db, table) {
  if (!/^[a-z_]+$/.test(table)) throw Error('Unexpected table');
  const row = table === 'order_items' ? "(to_jsonb(t)-'ingredient_keys_snapshot')" : 'to_jsonb(t)';
  return (await db.query(`SELECT count(*)::text AS n,md5(COALESCE(string_agg(${row}::text,'|' ORDER BY ${row}::text),'')) AS hash FROM "${table}" t`)).rows[0];
}
async function main() {
  const db = new Client({ connectionString: target.toString(), connectionTimeoutMillis: 8000 }); let transaction = false;
  try {
    await db.connect(); await db.query(apply ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN READ ONLY'); transaction = true;
    await db.query("SET LOCAL search_path=public; SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='15000ms'; SET LOCAL TIME ZONE 'UTC'");
    if (apply) await db.query("SELECT pg_advisory_xact_lock(hashtext('brewlite_inventory_migration'))");
    const ledger = (await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations')).rows;
    if (ledger.some(m => !m.finished_at && !m.rolled_back_at)) throw Error('Unfinished migration');
    const earlier = fs.readdirSync(dir).filter(n => /^\d+_/.test(n) && n < name);
    if (earlier.some(n => !ledger.some(m => m.migration_name === n && m.finished_at && !m.rolled_back_at))) throw Error('Earlier migration missing');
    const present = (await db.query("SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='ingredient_keys_snapshot'")).rows[0];
    const existing = ledger.find(m => m.migration_name === name && m.finished_at && !m.rolled_back_at);
    if (existing) {
      if (existing.checksum !== checksum || present?.data_type !== 'ARRAY' || present.is_nullable !== 'NO') throw Error('Checksum/schema mismatch');
      console.log('I05 already applied; snapshot column present; no changes made.');
    } else {
      if (present) throw Error('Unexpected partial schema');
      console.log('I05 pending; earlier migrations complete.');
      if (apply) {
        const tables = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'_prisma_migrations' ORDER BY table_name")).rows.map(r => r.table_name);
        const before = new Map(); for (const table of tables) before.set(table, await fingerprint(db, table));
        await db.query(sql);
        for (const table of tables) if (JSON.stringify(await fingerprint(db, table)) !== JSON.stringify(before.get(table))) throw Error('Business data changed');
        if ((await db.query('SELECT 1 FROM order_items WHERE cardinality(ingredient_keys_snapshot)<>0 LIMIT 1')).rowCount) throw Error('Legacy stock classification changed');
        await db.query('INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES($1,$2,now(),$3,now(),1)', [crypto.randomUUID(), checksum, name]);
        await db.query('COMMIT'); transaction = false;
        console.log('I05 applied; '+tables.length+' business table fingerprints preserved; legacy snapshots keep product stock.');
      }
    }
    if (transaction) { await db.query('ROLLBACK'); transaction = false; }
  } catch (e) {
    if (transaction) await db.query('ROLLBACK').catch(() => {});
    console.error('I05 migration failed: ' + (e.code || e.message)); process.exitCode = 1;
  } finally { await db.end(); }
}
void main();

// Apply only the selected I01/I02/I03 inventory migration when the native engine is blocked.
// --check is read-only. --apply never resets/seeds or rewrites migration history.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg');require('dotenv').config({path:path.resolve(__dirname,'../../.env'),quiet:true});
const categories=process.argv.includes('--categories');
const eggUnit=process.argv.includes('--egg-unit');if(categories&&eggUnit)throw Error('Choose only one inventory migration');
const name=eggUnit?'20261029170000_inventory_egg_unit':categories?'20261029150000_inventory_categories':'20261029100000_ingredient_inventory',label=eggUnit?'I03':categories?'I02':'I01',dir=path.resolve(__dirname,'../prisma/migrations');
const sql=fs.readFileSync(path.join(dir,name,'migration.sql'),'utf8'),checksum=crypto.createHash('sha256').update(sql).digest('hex');
const apply=process.argv.includes('--apply');if(process.argv.some(a=>a.startsWith('--')&&!['--check','--apply','--categories','--egg-unit'].includes(a)))throw Error('Unsupported option');
const target=new URL(process.env.DIRECT_URL??''),runtime=new URL(process.env.DATABASE_URL??'');
const local=['localhost','127.0.0.1','[::1]'].includes(target.hostname),neon=target.hostname.endsWith('.neon.tech')&&target.pathname==='/brewlite_dev';
if(!['postgresql:','postgres:'].includes(target.protocol)||target.pathname!==runtime.pathname||!(local&&/_(test|dev)$/.test(target.pathname)||neon&&['require','verify-full'].includes(target.searchParams.get('sslmode'))))throw Error('Expected same authorized local/Neon database');
if(neon)target.searchParams.set('sslmode','verify-full');
const tables=['ingredients','ingredient_receipts','ingredient_receipt_lines','ingredient_counts','ingredient_count_lines','ingredient_movements'];
async function fingerprint(db,table){if(!/^[a-z_]+$/.test(table))throw Error('Unexpected table');const row=categories&&table==='ingredients'?"(to_jsonb(t)-'low_stock_threshold')":'to_jsonb(t)';const r=await db.query(`SELECT count(*)::text AS n,md5(COALESCE(string_agg(${row}::text,'|' ORDER BY ${row}::text),'')) AS hash FROM "${table}" t`);return r.rows[0];}
async function main(){const db=new Client({connectionString:target.toString(),connectionTimeoutMillis:8000});let transaction=false;try{
  await db.connect();await db.query(apply?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN READ ONLY');transaction=true;
  await db.query("SET LOCAL search_path=public; SET LOCAL lock_timeout='2000ms'; SET LOCAL statement_timeout='15000ms'; SET LOCAL TIME ZONE 'UTC'");
  if(apply)await db.query("SELECT pg_advisory_xact_lock(hashtext('brewlite_inventory_migration'))");
  const ledger=(await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations')).rows;
  if(ledger.some(m=>!m.finished_at&&!m.rolled_back_at))throw Error('Unfinished migration exists');
  const expected=fs.readdirSync(dir).filter(n=>/^\d+_/.test(n)&&n<name).sort();
  if(expected.some(n=>!ledger.some(m=>m.migration_name===n&&m.finished_at&&!m.rolled_back_at)))throw Error('An earlier migration is missing; use the normal migration review first');
  const existing=ledger.find(m=>m.migration_name===name&&m.finished_at&&!m.rolled_back_at);
  const present=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])",[tables])).rows.map(r=>r.table_name);
  const constraint=(await db.query("SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='ingredients' AND c.conname='ingredients_unit_threshold_check'")).rowCount>0;
  const countable=(await db.query("SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='ingredients' AND c.conname='ingredients_countable_units'")).rowCount>0;
  const eggPresent=(await db.query("SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='IngredientUnit' AND e.enumlabel='EGG'")).rowCount>0;
  if(existing){if(existing.checksum!==checksum||present.length!==tables.length||((categories||eggUnit)&&!constraint)||(eggUnit&&(!countable||!eggPresent)))throw Error(label+' checksum/schema mismatch');console.log(label+' already applied; expected schema present; no changes made.');await db.query('ROLLBACK');transaction=false;return;}
  if(eggUnit?(present.length!==tables.length||!constraint||countable||eggPresent):categories?(present.length!==tables.length||constraint):present.length)throw Error('Unexpected partial inventory schema; refusing to overwrite');
  console.log('Preflight: earlier migrations complete; '+label+' pending; expected schema verified.');
  if(!apply){await db.query('ROLLBACK');transaction=false;return;}
  const old=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'_prisma_migrations' ORDER BY table_name")).rows.map(r=>r.table_name);
  const before=new Map();for(const t of old)before.set(t,await fingerprint(db,t));
  await db.query(sql);
  for(const t of old)if(JSON.stringify(await fingerprint(db,t))!==JSON.stringify(before.get(t)))throw Error('Pre-existing business data changed; rolling back');
  await db.query('INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count) VALUES($1,$2,now(),$3,NULL,NULL,now(),1)',[crypto.randomUUID(),checksum,name]);
  await db.query('COMMIT');transaction=false;console.log(label+' applied atomically; '+old.length+' table fingerprints preserved'+(categories?' excluding only warning threshold metadata.':'.'));
}catch(e){if(transaction)await db.query('ROLLBACK').catch(()=>{});console.error(label+' migration failed: '+(e.code||e.message));process.exitCode=1;}finally{await db.end();}}
void main();

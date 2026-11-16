// O01 additive metadata migration; no inventory, account or financial mutations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Client}=require('pg');
require('dotenv').config({path:path.resolve(__dirname,'../../.env'),quiet:true});
const apply=process.argv.includes('--apply');
if(process.argv.some(arg=>arg.startsWith('--')&&!['--apply','--check'].includes(arg)))throw Error('Unsupported option');
const name='20261115100000_order_aftercare',sql=fs.readFileSync(path.resolve(__dirname,'../prisma/migrations',name,'migration.sql'),'utf8');
const checksum=crypto.createHash('sha256').update(sql).digest('hex');
const target=new URL(process.env.DIRECT_URL??''),runtime=new URL(process.env.DATABASE_URL??''),local=['localhost','127.0.0.1','[::1]'].includes(target.hostname);
if(target.pathname!==runtime.pathname||!['postgres:','postgresql:'].includes(target.protocol)||!(local&&/_(test|dev)$/.test(target.pathname)||target.hostname.endsWith('.neon.tech')&&target.pathname==='/brewlite_dev'&&['require','verify-full'].includes(target.searchParams.get('sslmode'))))throw Error('Expected authorized development/test database');
if(!local)target.searchParams.set('sslmode','verify-full');
const additions={};
async function fingerprint(db,table){
 if(!/^[a-z_]+$/.test(table))throw Error('Unexpected table');
 const projection='to_jsonb(t)'+(additions[table]??[]).map(column=>"-'"+column+"'").join('');
 return(await db.query(`SELECT count(*)::text AS count,md5(COALESCE(string_agg((${projection})::text,'|' ORDER BY (${projection})::text),'')) AS hash FROM "${table}" t`)).rows[0];
}
(async()=>{
 const db=new Client({connectionString:target.toString(),connectionTimeoutMillis:10000});let active=false;
 try{
  await db.connect();await db.query(apply?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN READ ONLY');active=true;
  await db.query("SET LOCAL search_path=public;SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='20000ms'");
  if(apply)await db.query("SELECT pg_advisory_xact_lock(hashtext('brewlite_inventory_migration'))");
  const ledger=(await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations')).rows;
  if(ledger.some(row=>!row.finished_at&&!row.rolled_back_at))throw Error('Unfinished migration');
  const existing=ledger.find(row=>row.migration_name===name&&row.finished_at&&!row.rolled_back_at);
  const present=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='order_refunds'")).rowCount;
  if(existing){if(existing.checksum!==checksum||!present)throw Error('Migration checksum/schema mismatch');console.log('O01 already applied; no changes');}
  else{
   if(present)throw Error('Unexpected partial O01 schema');
   if(!(await db.query("SELECT to_regclass('order_recipe_ingredients') AS name")).rows[0].name)throw Error('I07 foundation required');
   console.log('O01 additive metadata migration pending');
   if(apply){
    const tables=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'_prisma_migrations' ORDER BY table_name")).rows.map(row=>row.table_name);
    const before=new Map();for(const table of tables)before.set(table,await fingerprint(db,table));
    await db.query(sql);
    for(const table of tables)if(JSON.stringify(await fingerprint(db,table))!==JSON.stringify(before.get(table)))throw Error('Historical business data changed: '+table);
    await db.query('INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES($1,$2,now(),$3,now(),1)',[crypto.randomUUID(),checksum,name]);
    await db.query('COMMIT');active=false;console.log('O01 applied; '+tables.length+' historical table fingerprints preserved; aftercare tables created without historical backfill');
   }
  }
  if(active){await db.query('ROLLBACK');active=false;}
 }catch(error){if(active)await db.query('ROLLBACK').catch(()=>{});console.error('O01 migration failed: '+(error.code||error.message));process.exitCode=1;}
 finally{await db.end();}
})();

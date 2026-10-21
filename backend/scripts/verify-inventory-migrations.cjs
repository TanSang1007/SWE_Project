// Local verification only. Creates and cleans up only its own UUID schema.
const { Client } = require('pg');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
require('dotenv').config({ path: resolve(__dirname, '../../.env'), quiet: true });
const url = process.env.DATABASE_URL;
const schema = `brewlite_a06_migration_${randomUUID().replaceAll('-', '')}`;
const db = new Client({ connectionString: url });
assert(['localhost', '127.0.0.1', '::1'].includes(db.host) && /_(dev|test)$/.test(db.database), 'Local development/test database required');
const dir = resolve(__dirname, '../prisma/migrations');
async function fingerprint(target, excludeMigrations = true) {
  const rows = {};
  for (const { table_name: table } of (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [target])).rows) {
    if (excludeMigrations && table === '_prisma_migrations') continue;
    rows[table] = (await db.query(`SELECT to_jsonb(t) AS row FROM "${target}"."${table}" t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function guards(target) {
  return (await db.query("SELECT conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname<>'idempotency_result_check' ORDER BY conname", [target])).rows;
}
async function reject(sql, params, code) { await assert.rejects(db.query(sql, params), e => e.code === code); }
async function main() {
  await db.connect(); const publicBefore = await fingerprint('public'); const publicGuards = await guards('public');
  const historyBefore = (await db.query('SELECT * FROM public._prisma_migrations ORDER BY migration_name')).rows;
  const existing = (await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.idempotency_requests'::regclass AND conname='idempotency_result_check'")).rows;
  assert.equal(existing.length, 1); assert.match(existing[0].definition, /order_id IS NOT NULL/);
  const report = { isolatedMigration: false, legacyRowsPreserved: false, guardsPreserved: false, constraintsVerified: false, developmentApplied: false };
  let created = false;
  try {
    await db.query(`CREATE SCHEMA "${schema}"`); created = true; await db.query(`SET search_path TO "${schema}"`);
    const names = readdirSync(dir).filter(n => /^\d+_/.test(n)).sort();
    for (const name of names.filter(n => !n.includes('_inventory_'))) await db.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
    const user = randomUUID(), order = randomUUID(), product = randomUUID();
    await db.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'test-only')", [user, `${user}@example.invalid`]);
    await db.query("INSERT INTO products(id,name,price,image_url,stock,version) VALUES($1,'Legacy A06',45000,'/images/legacy.svg',7,3)", [product]);
    await db.query("INSERT INTO orders(id,order_code,user_id,status,subtotal,total,paid_at) VALUES($1,$2,$3,'PAID',45000,45000,now())", [order, `BL-${order}`, user]);
    for (const operation of ['CREATE_ORDER', 'PAY_ORDER']) await db.query("INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state,order_id,response_status,response_body,completed_at) VALUES($1,$2,$3::text::\"IdempotencyOperation\",$3::text,'legacy','COMPLETED',$4,200,'{}',now())", [randomUUID(), user, operation, order]);
    const claim = (await db.query("SELECT id FROM idempotency_requests WHERE operation='PAY_ORDER'")).rows[0].id;
    await db.query("INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status) VALUES($1,$2,$3,$4,'PAY_ORDER',45000,'WALLET','SUCCEEDED')", [randomUUID(), order, user, claim]);
    await db.query('INSERT INTO loyalty_awards(id,order_id,user_id,points) VALUES($1,$2,$3,4)', [randomUUID(), order, user]);
    const before = await fingerprint(schema), beforeGuards = await guards(schema);
    for (const name of names.filter(n => n.includes('_inventory_'))) await db.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
    assert.equal(await fingerprint(schema), before); assert.deepEqual(await guards(schema), beforeGuards);
    report.isolatedMigration = report.legacyRowsPreserved = report.guardsPreserved = true;
    const insert = "INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state,order_id,response_status,response_body,completed_at) VALUES($1,$2,$3,$4,'test','COMPLETED',$5,$6,$7,now())";
    await db.query(insert, [randomUUID(), user, 'ADJUST_INVENTORY', 'inventory', null, 200, '{}']);
    for (const operation of ['CREATE_ORDER', 'PAY_ORDER']) {
      await reject(insert, [randomUUID(), user, operation, randomUUID(), null, 200, '{}'], '23514');
      await reject(insert, [randomUUID(), user, operation, randomUUID(), randomUUID(), 200, '{}'], '23503');
      await db.query(insert, [randomUUID(), user, operation, randomUUID(), order, 200, '{}']);
    }
    await reject(insert, [randomUUID(), user, 'ADJUST_INVENTORY', randomUUID(), order, 200, '{}'], '23514');
    await reject(insert, [randomUUID(), user, 'ADJUST_INVENTORY', randomUUID(), null, 99, '{}'], '23514');
    await reject(insert, [randomUUID(), user, 'ADJUST_INVENTORY', randomUUID(), null, 200, null], '23514');
    await reject(insert, [randomUUID(), user, 'ADJUST_INVENTORY', 'inventory', null, 200, '{}'], '23505');
    await reject("INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state,response_status) VALUES($1,$2,'ADJUST_INVENTORY','processing','test','PROCESSING',200)", [randomUUID(), user], '23514');
    report.constraintsVerified = true;
  } finally {
    await db.query('SET search_path TO public');
    if (created) await db.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
  assert.equal(await fingerprint('public'), publicBefore);
  if (process.argv.includes('--deploy')) {
    const result = spawnSync('npm.cmd', ['run', 'db:migrate:deploy', '--workspace', 'backend'], { cwd: resolve(__dirname, '../..'), shell: true, encoding: 'utf8', windowsHide: true });
    process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? ''); assert.equal(result.status, 0);
    assert.equal(await fingerprint('public'), publicBefore); assert.deepEqual(await guards('public'), publicGuards);
    const historyAfter = (await db.query('SELECT * FROM public._prisma_migrations ORDER BY migration_name')).rows;
    for (const row of historyBefore) assert.deepEqual(historyAfter.find(r => r.id === row.id), row);
    report.developmentApplied = true;
  }
  report.publicRowsPreserved = true;
  writeFileSync(resolve(__dirname, '../../Docs/A06_MIGRATION_EVIDENCE.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
main().catch(e => { console.error('A06 migration verification failed', e.code ?? e.name); process.exitCode = 1; }).finally(() => db.end());

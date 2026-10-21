import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { utcConnectionString } from '../../src/database/pg-connection';

// Explicit isolated URL only: this suite cannot fall back to development.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('Explicit isolated TEST_DATABASE_URL required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  !/^\/brewlite_(?:p01b1|fix01|b2a)_[a-f0-9]{12}_test$/.test(url.pathname)) throw new Error('Approved isolated restore required');
const schema = `p01b1_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const publicPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString) }) });
let user: string, order: string, claim: string;

async function reject(sql: string, values: unknown[] = [], code = '23514') {
  await client.query('SAVEPOINT expected_failure');
  try { await expect(client.query(sql, values)).rejects.toMatchObject({ code }); }
  finally { await client.query('ROLLBACK TO SAVEPOINT expected_failure'); }
}
async function newClaim() {
  const id = randomUUID();
  await client.query(`INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state,order_id,response_status,response_body,completed_at)
    VALUES($1::uuid,$2,'PAY_ORDER',$1::text,'synthetic','COMPLETED',$3,201,'{}',CURRENT_TIMESTAMP)`, [id, user, order]);
  return id;
}
function initiation(ref: string) {
  return { vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: 'TEST0001', vnp_Amount: '8500000',
    vnp_CurrCode: 'VND', vnp_TxnRef: ref, vnp_OrderInfo: `Thanh toan BrewLite ${ref}`, vnp_OrderType: 'other',
    vnp_Locale: 'vn', vnp_ReturnUrl: 'https://callback.example.org/payments/vnpay/return',
    vnp_IpAddr: '127.0.0.1', vnp_CreateDate: '20261015232000', vnp_ExpireDate: '20261015233500' };
}
function attemptData(changes: Record<string, unknown> = {}) {
  const ref = randomUUID().replaceAll('-', '');
  return { id: randomUUID(), order_id: order, idempotency_request_id: claim,
    merchant_code: 'TEST0001', txn_ref: ref, amount: '85000', create_date: '20261015232000',
    created_at: new Date('2026-10-15T16:20:00Z'), expires_at: new Date('2026-10-15T16:35:00Z'),
    request_parameters: JSON.stringify(initiation(ref)), ...changes };
}
function insert(table: 'payment_attempts' | 'payment_verifications', data: Record<string, unknown>) {
  const keys = Object.keys(data);
  // Column names are test constants only, never network input.
  return { sql: `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, values: Object.values(data) };
}
async function attempt(changes: Record<string, unknown> = {}) {
  const data = attemptData(changes), query = insert('payment_attempts', data);
  await client.query(query.sql, query.values); return data.id;
}
function ipn(attemptId: string, changes: Record<string, unknown> = {}) {
  return { id: randomUUID(), attempt_id: attemptId, source: 'IPN', state: 'VERIFIED',
    payload_hash: 'a'.repeat(64), payload: JSON.stringify({ merchantCode: 'TEST0001', amountMinor: '8500000' }),
    verified_at: new Date(), ...changes };
}
beforeAll(async () => {
  await client.connect();
  expect((await client.query<{ db: string }>('SELECT current_database() db')).rows[0].db).toBe(url.pathname.slice(1));
  await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const migrations = resolve(__dirname, '../../prisma/migrations');
  const chain = readdirSync(migrations).filter(name => /^\d+_/.test(name)).sort();
  expect(chain).toHaveLength(13);
  // Separate query/commit boundaries exercise the complete empty-to-current chain.
  for (const name of chain) await client.query(readFileSync(resolve(migrations, name, 'migration.sql'), 'utf8'));
});
afterAll(async () => {
  await publicPrisma.$disconnect();
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end();
});
beforeEach(async () => {
  await client.query('BEGIN'); user = randomUUID(); order = randomUUID();
  await client.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'NON_LOGIN_TEST_FIXTURE')", [user, user + '@example.invalid']);
  await client.query("INSERT INTO orders(id,order_code,user_id,status,subtotal,total) VALUES($1::uuid,$1::text,$2,'PENDING',85000,85000)", [order, user]);
  claim = await newClaim();
});
afterEach(async () => { await client.query('ROLLBACK'); });

test('creates pending attempt with approved defaults and no terminal Payment', async () => {
  const id = await attempt();
  expect((await client.query('SELECT provider,state,application_state,currency,amount::text FROM payment_attempts WHERE id=$1', [id])).rows[0])
    .toEqual({ provider: 'VNPAY_SANDBOX', state: 'AWAITING', application_state: 'PENDING', currency: 'VND', amount: '85000' });
  expect((await client.query<{ n: number }>('SELECT count(*)::int n FROM payments')).rows[0].n).toBe(0);
});
test.each<Record<string, unknown>>([
  { amount: '0' }, { amount: '-1' }, { amount: '10000000000' }, { provider: 'MOCK' }, { currency: 'USD' },
  { merchant_code: 'bad' }, { txn_ref: 'X'.repeat(32) }, { create_date: 'x'.repeat(14) },
  { expires_at: new Date('2026-10-15T16:00:00Z') }, { application_state: 'APPLIED' },
  { application_state: 'REVIEW' }, { application_state: 'REVIEW', review_reason: ' ' },
  { applied_at: new Date() }, { transaction_no: '0' }, { transaction_no: '000' },
  { transaction_no: 'abc' }, { response_code: 'xx' }, { transaction_status: 'x' },
  { request_parameters: '{}' }, { request_parameters: '[]' },
  { request_parameters: JSON.stringify({ ...initiation('a'.repeat(32)), vnp_SecureHash: 'forbidden' }) },
])('rejects invalid attempt %j', async change => {
  const q = insert('payment_attempts', attemptData(change)); await reject(q.sql, q.values);
});
test('rejects duplicate ref independently of pending-order uniqueness', async () => {
  const first = attemptData({ application_state: 'REVIEW', review_reason: 'TEST' });
  const q = insert('payment_attempts', first); await client.query(q.sql, q.values);
  claim = await newClaim(); const duplicate = insert('payment_attempts', attemptData({ txn_ref: first.txn_ref }));
  await reject(duplicate.sql, duplicate.values, '23505');
});
test('rejects duplicate pending attempts and idempotency claims', async () => {
  await attempt(); const sameClaim = insert('payment_attempts', attemptData({ application_state: 'REVIEW', review_reason: 'TEST' }));
  await reject(sameClaim.sql, sameClaim.values, '23505'); claim = await newClaim();
  const pending = insert('payment_attempts', attemptData()); await reject(pending.sql, pending.values, '23505');
});
test('allows REVIEW coexistence; unique provider txn number is scoped to merchant', async () => {
  await attempt({ application_state: 'APPLIED', state: 'SUCCEEDED', applied_at: new Date(), transaction_no: '123' });
  claim = await newClaim(); const duplicate = insert('payment_attempts', attemptData({ transaction_no: '123' }));
  await reject(duplicate.sql, duplicate.values, '23505');
  await attempt({ merchant_code: 'TEST0002', transaction_no: '123' });
  claim = await newClaim(); await attempt({ application_state: 'REVIEW', review_reason: 'LATE_SUCCESS' });
});
test('attempt FKs reject unknown references and restrict parent deletion', async () => {
  for (const change of [{ order_id: randomUUID() }, { idempotency_request_id: randomUUID() }]) {
    const q = insert('payment_attempts', attemptData(change)); await reject(q.sql, q.values, '23503');
  }
  await attempt(); await reject('DELETE FROM orders WHERE id=$1', [order], '23001');
  await reject('DELETE FROM idempotency_requests WHERE id=$1', [claim], '23001');
});
test('initiation columns immutable while outcome fields can progress', async () => {
  const id = await attempt();
  for (const column of ['amount', 'txn_ref', 'merchant_code', 'expires_at', 'request_parameters']) {
    const value = column === 'amount' ? '1' : column === 'expires_at' ? new Date() : column === 'request_parameters' ? '{}' : 'b'.repeat(column === 'txn_ref' ? 32 : 8);
    await reject(`UPDATE payment_attempts SET ${column}=$1 WHERE id=$2`, [value, id]);
  }
  await client.query("UPDATE payment_attempts SET state='FAILED',application_state='APPLIED',applied_at=CURRENT_TIMESTAMP WHERE id=$1", [id]);
});
test('IPN receipt creation, deduplication, FK and immutable evidence', async () => {
  const id = await attempt(), data = ipn(id), q = insert('payment_verifications', data); await client.query(q.sql, q.values);
  const duplicate = insert('payment_verifications', ipn(id)); await reject(duplicate.sql, duplicate.values, '23505');
  const missing = insert('payment_verifications', ipn(randomUUID())); await reject(missing.sql, missing.values, '23503');
  await reject('UPDATE payment_verifications SET payload=\'{}\' WHERE id=$1', [data.id]);
  await reject('DELETE FROM payment_verifications WHERE id=$1', [data.id]);
  await reject('DELETE FROM payment_attempts WHERE id=$1', [id], '23001');
  await client.query('UPDATE payment_verifications SET processed_at=CURRENT_TIMESTAMP WHERE id=$1', [data.id]);
  await reject('UPDATE payment_verifications SET processed_at=NULL WHERE id=$1', [data.id]);
});
test.each<Record<string, unknown>>([
  { state: 'REQUESTED' }, { request_id: 'a'.repeat(32) }, { query_create_date: '20261015232000' },
  { payload: null }, { payload: '[]' }, { payload_hash: null }, { payload_hash: 'z'.repeat(64) }, { verified_at: null },
  { payload: JSON.stringify({ HashSecret: 'synthetic-not-allowed' }) },
  { payload: JSON.stringify({ bankCode: { nested: 'not-allowed' } }) },
])('rejects invalid evidence %j', async change => {
  const q = insert('payment_verifications', ipn(await attempt(), change)); await reject(q.sql, q.values);
});
test('QUERYDR requested -> verified once, global request ID uniqueness, processed marker', async () => {
  const id = await attempt(), requestId = randomUUID().replaceAll('-', ''), receipt = randomUUID();
  await client.query(`INSERT INTO payment_verifications(id,attempt_id,source,state,request_id,query_create_date)
    VALUES($1,$2,'QUERYDR','REQUESTED',$3,'20261015232000')`, [receipt, id, requestId]);
  await reject(`INSERT INTO payment_verifications(id,attempt_id,source,state,request_id,query_create_date)
    VALUES($1,$2,'QUERYDR','REQUESTED',$3,'20261015232000')`, [randomUUID(), id, requestId], '23505');
  await reject('UPDATE payment_verifications SET processed_at=CURRENT_TIMESTAMP WHERE id=$1', [receipt]);
  await client.query(`UPDATE payment_verifications SET state='VERIFIED',payload='{}',payload_hash=$1,verified_at=CURRENT_TIMESTAMP WHERE id=$2`, ['b'.repeat(64), receipt]);
  await reject("UPDATE payment_verifications SET state='UNRESOLVED',payload=NULL,payload_hash=NULL,verified_at=NULL WHERE id=$1", [receipt]);
});
test('QUERYDR unresolved cannot later manufacture verified evidence', async () => {
  const id = await attempt(), receipt = randomUUID();
  await client.query(`INSERT INTO payment_verifications(id,attempt_id,source,state,request_id,query_create_date)
    VALUES($1,$2,'QUERYDR','REQUESTED',$3,'20261015232000')`, [receipt, id, randomUUID().replaceAll('-', '')]);
  await client.query("UPDATE payment_verifications SET state='UNRESOLVED',error_code='QUERY_TIMEOUT' WHERE id=$1", [receipt]);
  await reject("UPDATE payment_verifications SET state='VERIFIED',payload='{}',payload_hash=$1,verified_at=CURRENT_TIMESTAMP WHERE id=$2", ['c'.repeat(64), receipt]);
});
test('legacy defaults and zero/gateway provider method/amount constraints', async () => {
  const payment = randomUUID();
  await client.query(`INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status,failure_code)
    VALUES($1::uuid,$2,$3,$4,$1::text,85000,'CARD','FAILED','MOCK_DECLINED')`, [payment, order, user, claim]);
  expect((await client.query('SELECT provider,gateway_attempt_id,confirmed_at,failure_code FROM payments WHERE id=$1', [payment])).rows[0])
    .toEqual({ provider: 'MOCK', gateway_attempt_id: null, confirmed_at: null, failure_code: 'MOCK_DECLINED' });
  await reject("UPDATE payments SET method='VNPAY' WHERE id=$1", [payment]);
  await reject("UPDATE payments SET provider='INTERNAL_ZERO',method='ZERO_TOTAL',amount=0,confirmed_at=CURRENT_TIMESTAMP WHERE id=$1", [payment]);
  await client.query("UPDATE payments SET provider='INTERNAL_ZERO',method='ZERO_TOTAL',amount=0,status='SUCCEEDED',failure_code=NULL,confirmed_at=CURRENT_TIMESTAMP WHERE id=$1", [payment]);
  await reject("UPDATE payments SET amount=1 WHERE id=$1", [payment]);
});
test('gateway Payment requires confirmed attempt, unique link, original success-per-order constraint', async () => {
  const id = await attempt();
  const payment = randomUUID();
  await reject(`INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status,provider)
    VALUES($1::uuid,$2,$3,$4,$1::text,85000,'VNPAY','SUCCEEDED','VNPAY_SANDBOX')`, [payment, order, user, claim]);
  await client.query(`INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status,provider,gateway_attempt_id,confirmed_at)
    VALUES($1::uuid,$2,$3,$4,$1::text,85000,'VNPAY','SUCCEEDED','VNPAY_SANDBOX',$5,CURRENT_TIMESTAMP)`, [payment, order, user, claim, id]);
  await reject('DELETE FROM payment_attempts WHERE id=$1', [id], '23001');
  const otherClaim = await newClaim();
  await reject(`INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status)
    VALUES($1::uuid,$2,$3,$4,$1::text,85000,'WALLET','SUCCEEDED')`, [randomUUID(), order, user, otherClaim], '23505');
});
test('generated candidate client queries restored historical Mock data and empty gateway tables', async () => {
  const payments = await publicPrisma.payment.findMany();
  expect(payments.length).toBeGreaterThan(0);
  for (const p of payments) expect(p).toMatchObject({ provider: 'MOCK', gatewayAttemptId: null, confirmedAt: null });
  expect(await publicPrisma.paymentAttempt.count()).toBe(0);
  expect(await publicPrisma.paymentVerification.count()).toBe(0);
});

test('gateway failed Payment enforces stable failure code, nonzero amount, FK and unique attempt link', async () => {
  const id = await attempt(), payment = randomUUID();
  await client.query(`INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status,failure_code,provider,gateway_attempt_id,confirmed_at)
    VALUES($1::uuid,$2,$3,$4,$1::text,85000,'VNPAY','FAILED','VNPAY_DECLINED','VNPAY_SANDBOX',$5,CURRENT_TIMESTAMP)`, [payment, order, user, claim, id]);
  await reject("UPDATE payments SET failure_code='MOCK_DECLINED' WHERE id=$1", [payment]);
  await reject('UPDATE payments SET amount=0 WHERE id=$1', [payment]);
  await reject('UPDATE payments SET gateway_attempt_id=$1 WHERE id=$2', [randomUUID(), payment], '23503');
  const otherClaim = await newClaim();
  await reject(`INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status,failure_code,provider,gateway_attempt_id,confirmed_at)
    VALUES($1::uuid,$2,$3,$4,$1::text,85000,'VNPAY','FAILED','VNPAY_DECLINED','VNPAY_SANDBOX',$5,CURRENT_TIMESTAMP)`, [randomUUID(), order, user, otherClaim, id], '23505');
});

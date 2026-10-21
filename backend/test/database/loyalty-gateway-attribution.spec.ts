import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../../src/generated/prisma/client';
import { utcConnectionString } from '../../src/database/pg-connection';
import { lockUser } from '../../src/orders/order-policy';
import { effect, lockOrder, persistEffects, reconcileAccount } from '../../src/loyalty/loyalty-accounting';

// Test-only transaction simulations. No route, signer, network or runtime settlement.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !/^\/brewlite_(?:fix01|b2a)_[a-f0-9]{12}_test$/.test(new URL(connectionString).pathname)) throw Error('FIX01 isolated database required');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname)) throw Error('Local isolated database required');
const schema = `fix01_${randomUUID().replaceAll('-', '')}`;
const url = new URL(connectionString); url.searchParams.set('options', `-c search_path=${schema}`);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(url.toString()) }, { schema }) });
const client = new Client({ connectionString });
const txWork = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(work, { timeout: 5000 });
type Fixture = { user: string; order: string; product: string };

beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
});
afterAll(async () => { await db.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });

async function attempt(tx: Prisma.TransactionClient, f: Fixture, key = randomUUID()) {
  const claim = await tx.idempotencyRequest.create({ data: { userId: f.user, operation: 'PAY_ORDER', idempotencyKey: key, requestHash: 'FIX01_SYNTHETIC', state: 'PROCESSING' } });
  const ref = randomUUID().replaceAll('-', '');
  const a = await tx.paymentAttempt.create({ data: { orderId: f.order, idempotencyRequestId: claim.id, merchantCode: 'TEST0001', txnRef: ref, amount: '85000',
    createDate: '20261017090000', expiresAt: new Date(Date.now() + 900000), requestParameters: {
      vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: 'TEST0001', vnp_Amount: '8500000', vnp_CurrCode: 'VND', vnp_TxnRef: ref,
      vnp_OrderInfo: `Thanh toan BrewLite ${ref}`, vnp_OrderType: 'other', vnp_Locale: 'vn', vnp_ReturnUrl: 'https://callback.example.org/payments/vnpay/return',
      vnp_IpAddr: '127.0.0.1', vnp_CreateDate: '20261017090000', vnp_ExpireDate: '20261017091500',
    } } });
  await tx.idempotencyRequest.update({ where: { id: claim.id }, data: { orderId: f.order, state: 'COMPLETED', responseStatus: 201, responseBody: { attemptId: a.id }, completedAt: new Date() } });
  return a;
}
async function fixture() {
  return txWork(async tx => {
    const user = await tx.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'NON_LOGIN_SYNTHETIC', loyaltyPoints: 100 } });
    await tx.loyaltyEntry.create({ data: { userId: user.id, kind: 'OPENING', points: 100, availableDelta: 100, reservedDelta: 0, debtDelta: 0n, effectKey: `OPENING:${user.id}` } });
    const product = await tx.product.create({ data: { name: 'FIX01 isolated fixture', price: '90000', imageUrl: '/fixture', stock: 9 } });
    const order = await tx.order.create({ data: { userId: user.id, orderCode: randomUUID(), status: 'PENDING', subtotal: '90000', total: '85000', redeemedPoints: 50, loyaltyDiscountAmount: '5000', redemptionState: 'RESERVED', reservationCycle: 1 } });
    await tx.orderItem.create({ data: { orderId: order.id, productId: product.id, productNameSnapshot: product.name, size: 'S', basePrice: '90000', sizeExtraPrice: '0', unitPrice: '90000', qty: 1, lineTotal: '90000' } });
    const before = { userId: user.id, available: 100n, reserved: 0n, debt: 0n }, account = { ...before };
    await persistEffects(tx, before, account, [effect(account, 'RESERVE', 50, { orderId: order.id, cycle: 1 })]);
    const f = { user: user.id, order: order.id, product: product.id };
    return { ...f, attempt: (await attempt(tx, f)).id };
  });
}
// Synthetic VERIFIED rows model trusted persistence only, never provider authenticity.
async function close(f: Fixture, id: string, success: boolean) {
  return txWork(async tx => {
    await lockUser(tx, f.user); await lockOrder(tx, f.order);
    await tx.$queryRaw`SELECT id FROM payment_attempts WHERE order_id=${f.order}::uuid ORDER BY id FOR UPDATE`;
    const existing = await tx.payment.findUnique({ where: { gatewayAttemptId: id } }); if (existing) return existing;
    const before = await reconcileAccount(tx, f.user), account = { ...before };
    const a = await tx.paymentAttempt.findUniqueOrThrow({ where: { id } });
    const order = await tx.order.findUniqueOrThrow({ where: { id: f.order } });
    const now = new Date();
    await tx.paymentVerification.create({ data: { attemptId: id, source: 'IPN', state: 'VERIFIED', payload: { responseCode: success ? '00' : '24', transactionStatus: success ? '00' : '02' }, payloadHash: randomUUID().replaceAll('-', '').repeat(2), verifiedAt: now, processedAt: now } });
    await tx.paymentAttempt.update({ where: { id }, data: { state: success ? 'SUCCEEDED' : 'FAILED', applicationState: 'APPLIED', verifiedAt: now, appliedAt: now } });
    const claim = await tx.idempotencyRequest.findUniqueOrThrow({ where: { id: a.idempotencyRequestId } });
    const payment = await tx.payment.create({ data: { userId: f.user, orderId: f.order, idempotencyRequestId: claim.id, idempotencyKey: claim.idempotencyKey, amount: order.total, method: 'VNPAY', provider: 'VNPAY_SANDBOX', gatewayAttemptId: id, confirmedAt: now, status: success ? 'SUCCEEDED' : 'FAILED', failureCode: success ? null : 'VNPAY_DECLINED' } });
    await tx.order.update({ where: { id: order.id }, data: { status: success ? 'PAID' : 'PAYMENT_FAILED', redemptionState: success ? 'SETTLED' : 'RELEASED', paidAt: success ? now : null } });
    const rows = [effect(account, success ? 'SETTLE' : 'RELEASE', 50, { orderId: f.order, paymentId: payment.id, cycle: order.reservationCycle })];
    if (success) {
      await tx.loyaltyAward.create({ data: { userId: f.user, orderId: f.order, points: 8 } });
      rows.push(effect(account, 'EARN', 8, { orderId: f.order, paymentId: payment.id }));
    } else await tx.product.update({ where: { id: f.product }, data: { stock: { increment: 1 }, version: { increment: 1 } } });
    await persistEffects(tx, before, account, rows);
    return payment;
  });
}
async function failed() { const f = await fixture(); await close(f, f.attempt, false); return f; }
async function retry(f: Fixture, key = randomUUID(), fault = false) {
  return txWork(async tx => {
    await lockUser(tx, f.user); await lockOrder(tx, f.order);
    await tx.$queryRaw`SELECT id FROM payment_attempts WHERE order_id=${f.order}::uuid ORDER BY id FOR UPDATE`;
    const claim = await tx.idempotencyRequest.findUnique({ where: { userId_operation_idempotencyKey: { userId: f.user, operation: 'PAY_ORDER', idempotencyKey: key } } });
    if (claim) return (claim.responseBody as { attemptId: string }).attemptId;
    const o = await tx.order.findUniqueOrThrow({ where: { id: f.order } });
    if (o.status !== 'PAYMENT_FAILED') throw Error('ineligible');
    const before = await reconcileAccount(tx, f.user), account = { ...before };
    const cycle = o.reservationCycle + 1;
    await tx.order.update({ where: { id: o.id }, data: { status: 'PENDING', redemptionState: 'RESERVED', reservationCycle: cycle } });
    const a = await attempt(tx, f, key);
    const p = await tx.product.findUniqueOrThrow({ where: { id: f.product } });
    const changed = await tx.product.updateMany({ where: { id: p.id, version: p.version, stock: { gte: 1 } }, data: { stock: { decrement: 1 }, version: { increment: 1 } } });
    if (changed.count !== 1) throw Error('stock conflict');
    await persistEffects(tx, before, account, [effect(account, 'RESERVE', 50, { orderId: o.id, paymentAttemptId: a.id, cycle })]);
    if (fault) throw Error('technical rollback');
    return a.id;
  });
}
async function proof(f: Fixture) { return txWork(async tx => { await lockUser(tx, f.user); return reconcileAccount(tx, f.user); }); }
async function rejected(sql: string, values: unknown[], code = '23514') {
  await client.query('BEGIN');
  try { await expect(client.query(sql, values)).rejects.toMatchObject({ code }); }
  finally { await client.query('ROLLBACK'); }
}
function reserveValues(f: Fixture, id: string, cycle = 2) { return [randomUUID(), f.user, f.order, id, cycle, `GATEWAY_ATTEMPT:${id}`]; }
const insertReserve = "INSERT INTO loyalty_entries(id,user_id,order_id,payment_attempt_id,kind,cycle,points,available_delta,reserved_delta,debt_delta,effect_key) VALUES($1,$2,$3,$4,'RESERVE',$5,50,-50,50,0,$6)";

test('gateway retry reserves through durable Attempt only; initial source remains CREATE_ORDER', async () => {
  const f = await failed(), count = await db.payment.count({ where: { orderId: f.order } });
  const id = await retry(f);
  expect(await db.payment.count({ where: { orderId: f.order } })).toBe(count);
  const rows = await db.loyaltyEntry.findMany({ where: { orderId: f.order, kind: 'RESERVE' }, orderBy: { cycle: 'asc' } });
  expect(rows[0]).toMatchObject({ cycle: 1, paymentId: null, paymentAttemptId: null, effectKey: `CREATE_ORDER:${f.order}` });
  expect(rows[1]).toMatchObject({ cycle: 2, paymentId: null, paymentAttemptId: id, effectKey: `GATEWAY_ATTEMPT:${id}` });
  expect(await proof(f)).toMatchObject({ available: 50n, reserved: 50n, debt: 0n });
});
test('same-key concurrent replay returns same source without second stock/points reservation', async () => {
  const f = await failed(), key = randomUUID(); const ids = await Promise.all([retry(f, key), retry(f, key), retry(f, key)]);
  expect(new Set(ids).size).toBe(1);
  expect(await db.loyaltyEntry.count({ where: { orderId: f.order, kind: 'RESERVE', cycle: 2 } })).toBe(1);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(9);
  expect(await proof(f)).toMatchObject({ available: 50n, reserved: 50n });
});
test('different-key concurrent retries cannot double RESERVE', async () => {
  const f = await failed(), results = await Promise.allSettled([retry(f), retry(f)]);
  expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  expect(await db.paymentAttempt.count({ where: { orderId: f.order, applicationState: 'PENDING' } })).toBe(1);
  expect(await db.loyaltyEntry.count({ where: { orderId: f.order, kind: 'RESERVE', cycle: 2 } })).toBe(1);
});
test('technical rollback leaves no orphan claim, Attempt, cycle, journal or stock delta', async () => {
  const f = await failed(), before = await proof(f); const key = randomUUID();
  await expect(retry(f, key, true)).rejects.toThrow('technical rollback');
  expect(await proof(f)).toEqual(before);
  expect(await db.idempotencyRequest.count({ where: { userId: f.user, idempotencyKey: key } })).toBe(0);
  expect(await db.paymentAttempt.count({ where: { orderId: f.order } })).toBe(1);
  expect((await db.order.findUniqueOrThrow({ where: { id: f.order } })).reservationCycle).toBe(1);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(10);
});
test.each([false, true])('verified synthetic outcome success=%s closes exact cycle once; source stays immutable', async success => {
  const f = await failed(), id = await retry(f); const payment = await close(f, id, success); await close(f, id, success);
  const kind = success ? 'SETTLE' : 'RELEASE';
  const rows = await db.loyaltyEntry.findMany({ where: { orderId: f.order, cycle: 2 } });
  expect(rows.filter(e => e.kind === kind)).toHaveLength(1);
  expect(rows.find(e => e.kind === kind)).toMatchObject({ paymentId: payment.id, paymentAttemptId: null });
  expect(rows.find(e => e.kind === 'RESERVE')).toMatchObject({ paymentId: null, paymentAttemptId: id });
  expect(await proof(f)).toMatchObject({ available: success ? 58n : 100n, reserved: 0n, debt: 0n });
  await rejected('UPDATE loyalty_entries SET payment_id=$1 WHERE payment_attempt_id=$2', [payment.id, id]);
});
test.each(['UNKNOWN', 'REVIEW'] as const)('%s cannot release via unpaid cancellation or fabricate settlement', async state => {
  const f = await failed(), id = await retry(f);
  await db.paymentAttempt.update({ where: { id }, data: state === 'REVIEW' ? { applicationState: 'REVIEW', reviewReason: 'SYNTHETIC' } : { state } });
  await rejected("INSERT INTO loyalty_entries(id,user_id,order_id,kind,cycle,points,available_delta,reserved_delta,debt_delta,effect_key) VALUES($1,$2,$3,'RELEASE',2,50,50,-50,0,$4)", [randomUUID(), f.user, f.order, `UNPAID_CANCEL:${f.order}`]);
  const a = await db.paymentAttempt.findUniqueOrThrow({ where: { id } });
  const payment = randomUUID();
  await client.query('BEGIN');
  try {
    await client.query("INSERT INTO payments(id,user_id,order_id,idempotency_request_id,idempotency_key,amount,method,provider,gateway_attempt_id,status,confirmed_at) VALUES($1::uuid,$2,$3,$4,$1::text,85000,'VNPAY','VNPAY_SANDBOX',$5,'SUCCEEDED',now())", [payment, f.user, f.order, a.idempotencyRequestId, id]);
    await expect(client.query("INSERT INTO loyalty_entries(id,user_id,order_id,payment_id,kind,cycle,points,available_delta,reserved_delta,debt_delta,effect_key) VALUES($1,$2,$3,$4,'SETTLE',2,50,0,-50,0,$5)", [randomUUID(), f.user, f.order, payment, `PAY_ORDER:${payment}`])).rejects.toMatchObject({ code: '23514' });
  } finally { await client.query('ROLLBACK'); }
  expect(await proof(f)).toMatchObject({ available: 50n, reserved: 50n });
});
test('cross-owner, cross-order, wrong key and cycle are rejected by database', async () => {
  const f = await failed(), id = await retry(f), other = await failed();
  for (const values of [reserveValues({ ...f, user: other.user }, id), reserveValues({ ...f, order: other.order }, id), reserveValues(f, id, 3), [...reserveValues(f, id).slice(0, 5), `GATEWAY_ATTEMPT:${randomUUID()}`]]) await rejected(insertReserve, values);
});
test('two attribution sources, missing source, and Attempt source on other kinds are rejected', async () => {
  const f = await failed(), id = await retry(f), payment = await db.payment.findFirstOrThrow({ where: { orderId: f.order } });
  await rejected(insertReserve.replace('payment_attempt_id,kind', 'payment_attempt_id,payment_id,kind').replace("$4,'RESERVE'", "$4,$7,'RESERVE'"), [...reserveValues(f, id), payment.id]);
  await rejected(insertReserve, [randomUUID(), f.user, f.order, null, 2, `CREATE_ORDER:${f.order}`]);
  await rejected(insertReserve.replace("'RESERVE'", "'RELEASE'"), reserveValues(f, id));
  await rejected(insertReserve, reserveValues(f, id), '23505');
});
test('one cycle cannot be both RELEASE and SETTLE; restrict FK prevents source deletion', async () => {
  const f = await failed(), id = await retry(f); await close(f, id, false);
  await rejected('DELETE FROM payment_attempts WHERE id=$1', [id], '23001');
  await rejected("INSERT INTO loyalty_entries(id,user_id,order_id,payment_id,kind,cycle,points,available_delta,reserved_delta,debt_delta,effect_key) SELECT $1,user_id,order_id,payment_id,'SETTLE',cycle,points,0,-points,0,effect_key FROM loyalty_entries WHERE order_id=$2 AND kind='RELEASE' AND cycle=2", [randomUUID(), f.order]);
});
test('effect helper rejects mixed sources before mutating account', () => {
  const account = { userId: randomUUID(), available: 100n, reserved: 0n, debt: 0n };
  expect(() => effect(account, 'RESERVE', 50, { orderId: randomUUID(), paymentId: randomUUID(), paymentAttemptId: randomUUID(), cycle: 2 })).toThrow();
  expect(account).toMatchObject({ available: 100n, reserved: 0n });
});
test('terminal gateway Payment attribution and journal cannot be reassigned or deleted', async () => {
  const f = await failed(), id = await retry(f), payment = await close(f, id, false);
  await rejected("UPDATE payments SET provider='MOCK',method='WALLET',gateway_attempt_id=NULL WHERE id=$1", [payment.id]);
  await rejected('UPDATE payments SET confirmed_at=now() WHERE id=$1', [payment.id]);
  await rejected('DELETE FROM loyalty_entries WHERE payment_attempt_id=$1', [id]);
});
test('mismatched terminal cycle and missing VERIFIED evidence cannot close reservation', async () => {
  const f = await failed(), id = await retry(f), payment = await close(f, id, false);
  await rejected("INSERT INTO loyalty_entries(id,user_id,order_id,payment_id,kind,cycle,points,available_delta,reserved_delta,debt_delta,effect_key) VALUES($1,$2,$3,$4,'RELEASE',3,50,50,-50,0,$5)", [randomUUID(), f.user, f.order, payment.id, `PAY_ORDER:${payment.id}`]);
  const other = await fixture();
  await db.paymentAttempt.update({ where: { id: other.attempt }, data: { applicationState: 'APPLIED', state: 'FAILED', appliedAt: new Date(), verifiedAt: new Date() } });
  const a = await db.paymentAttempt.findUniqueOrThrow({ where: { id: other.attempt } });
  await client.query('BEGIN');
  try {
    const p = randomUUID();
    await client.query("INSERT INTO payments(id,user_id,order_id,idempotency_request_id,idempotency_key,amount,method,provider,gateway_attempt_id,status,failure_code,confirmed_at) VALUES($1::uuid,$2,$3,$4,$1::text,85000,'VNPAY','VNPAY_SANDBOX',$5,'FAILED','VNPAY_DECLINED',now())", [p, other.user, other.order, a.idempotencyRequestId, other.attempt]);
    await client.query("UPDATE orders SET status='PAYMENT_FAILED',redemption_state='RELEASED' WHERE id=$1", [other.order]);
    await expect(client.query("INSERT INTO loyalty_entries(id,user_id,order_id,payment_id,kind,cycle,points,available_delta,reserved_delta,debt_delta,effect_key) VALUES($1,$2,$3,$4,'RELEASE',1,50,50,-50,0,$5)", [randomUUID(), other.user, other.order, p, `PAY_ORDER:${p}`])).rejects.toMatchObject({ code: '23514' });
  } finally { await client.query('ROLLBACK'); }
});

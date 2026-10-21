import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PrismaClient } from '../../src/generated/prisma/client';
import { configureApp } from '../../src/common/configure-app';
import { utcConnectionString } from '../../src/database/pg-connection';
import { lockUser } from '../../src/orders/order-policy';
import { reconcileAccount } from '../../src/loyalty/loyalty-accounting';
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { QUERYDR_TRANSPORT } from '../../src/payments/vnpay/querydr-transport';
import { initiationSettings } from '../../src/payments/vnpay/initiation-config';
import { SANDBOX_PAYMENT_URL } from '../../src/payments/vnpay/vnpay-config';
import { signParameters, canonicalize } from '../../src/payments/vnpay/vnpay-signing';
import { OrderService } from '../../src/orders/order.service';
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !/^\/brewlite_b2a_[a-f0-9]{12}_test$/.test(new URL(connectionString).pathname)
  || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname)) throw Error('Local isolated test database required');
const schema = `b2c2_${randomUUID().replaceAll('-', '')}`, url = new URL(connectionString);
url.searchParams.set('options', `-c search_path=${schema}`);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(url.toString()) }, { schema }) });
const client = new Client({ connectionString });
const settings = new ConfigService({ PAYMENT_PROVIDER_MODE: 'MOCK', VNPAY_INITIATION_CONFIG: null,
  JWT_SECRET: 'synthetic-b2c2-isolated-jwt-at-least-32-bytes', JWT_EXPIRES_IN: 3600, FRONTEND_ORIGIN: 'http://localhost:3000' });
const mock = jest.fn(), outbound = jest.fn();
const secret = 'synthetic-b2a-zero-race-only-not-a-merchant-secret';
let app: NestExpressApplication, jwt: JwtService, admin: string, staff: string;
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).overrideProvider(ConfigService).useValue(settings)
    .overrideProvider(MockPaymentService).useValue({ result: mock }).overrideProvider(QUERYDR_TRANSPORT).useValue({ post: outbound }).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  admin = (await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'NON_LOGIN_SYNTHETIC', role: 'ADMIN' } })).id;
  staff = (await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'NON_LOGIN_SYNTHETIC', role: 'STAFF' } })).id;
});
beforeEach(() => { settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); settings.set('VNPAY_INITIATION_CONFIG', null); mock.mockReset(); mock.mockImplementation(() => { throw Error('Mock must not be called'); }); outbound.mockReset(); outbound.mockRejectedValue(Error('Network disabled')); });
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { if (app) await app.close(); await db.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
type Fixture = { user: string; order: string; product: string; promotion: string };
const auth = (id: string) => 'Bearer ' + jwt.sign({ sub: id });
const confirm = (f: Fixture, key: string = randomUUID()) => request(app.getHttpServer()).post(`/orders/${f.order}/confirm-zero`).set('Authorization', auth(f.user)).set('Idempotency-Key', key);
const cancel = (f: Fixture) => request(app.getHttpServer()).post(`/orders/${f.order}/cancel`).set('Authorization', auth(f.user)).send({});
async function createOrder(user: string, product: string, promotion: string, points: number) {
  const r = await request(app.getHttpServer()).post('/orders').set('Authorization', auth(user)).set('Idempotency-Key', randomUUID())
    .send({ items: [{ productId: product, size: 'S', qty: 1, toppingIds: [] }], promotionCode: promotion, redeemedPoints: points }).expect(201);
  return (r.body as { id: string }).id;
}
async function fixture(points = 900, balance = 1000) {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'NON_LOGIN_SYNTHETIC', loyaltyPoints: balance } });
  await db.loyaltyEntry.create({ data: { userId: user.id, kind: 'OPENING', points: balance, availableDelta: balance, reservedDelta: 0, debtDelta: 0n, effectKey: `OPENING:${user.id}` } });
  const product = await db.product.create({ data: { name: 'Zero confirmation isolated product', price: '100000', stock: 10, imageUrl: '/fixture', sizes: { create: { size: 'S', extraPrice: '0' } } } });
  const cart = await db.cart.create({ data: { userId: user.id } }); await db.cartItem.create({ data: { cartId: cart.id, productId: product.id, size: 'S', qty: 1, configurationKey: `${product.id}:S` } });
  const code = points === 0 ? 'Z' + randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase() : 'BREW10K';
  await db.promotion.upsert({ where: { code }, update: { isActive: true }, create: { code, discountAmount: points === 0 ? '100000' : '10000', startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01'), isActive: true } });
  return { user: user.id, product: product.id, promotion: code, order: await createOrder(user.id, product.id, code, points) };
}
async function proof(f: Fixture) { return db.$transaction(async tx => { await lockUser(tx, f.user); return reconcileAccount(tx, f.user); }); }
async function snapshot(f: Fixture) {
  return { user: await db.user.findUniqueOrThrow({ where: { id: f.user } }), order: await db.order.findUniqueOrThrow({ where: { id: f.order }, include: { items: { include: { toppings: true } } } }),
    stock: await db.product.findUniqueOrThrow({ where: { id: f.product } }), cart: await db.cart.findUniqueOrThrow({ where: { userId: f.user }, include: { items: { orderBy: { id: 'asc' } } } }),
    payments: await db.payment.findMany({ where: { orderId: f.order }, orderBy: { id: 'asc' } }), awards: await db.loyaltyAward.findMany({ where: { orderId: f.order } }),
    journal: await db.loyaltyEntry.findMany({ where: { userId: f.user }, orderBy: { sequence: 'asc' } }), claims: await db.idempotencyRequest.findMany({ where: { userId: f.user }, orderBy: { id: 'asc' } }),
    attempts: await db.paymentAttempt.findMany({ where: { orderId: f.order } }), receipts: await db.paymentVerification.findMany({ where: { attempt: { orderId: f.order } } }) };
}
function gateway() {
  const values = initiationSettings({ NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_TEST_ONLY: 'true', DATABASE_URL: connectionString, TEST_DATABASE_URL: connectionString,
    VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
    VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' });
  settings.set('PAYMENT_PROVIDER_MODE', values.PAYMENT_PROVIDER_MODE); settings.set('VNPAY_INITIATION_CONFIG', values.VNPAY_INITIATION_CONFIG);
}
const initiate = (f: Fixture, key: string = randomUUID()) => request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', auth(f.user)).set('Idempotency-Key', key).send({ orderId: f.order });

test.each([0, 900])('explicit confirmation with redeemedPoints%i: Payment0/Award0/EARN0, conserved stock, no gateway or Mock', async points => {
  const f = await fixture(points), before = await snapshot(f); expect(before.order.status).toBe('PENDING'); expect(before.payments).toHaveLength(0); expect(before.awards).toHaveLength(0);
  const r = await confirm(f).send({}).expect(200), after = await snapshot(f);
  expect(r.body).toMatchObject({ payment: { provider: 'INTERNAL_ZERO', method: 'ZERO_TOTAL', status: 'SUCCEEDED', amount: '0' }, order: { status: 'PAID' },
    loyalty: { awardedPoints: 0, redeemedPoints: points, availablePointsAdded: 0, debtOffsetPoints: 0 }, cashRefundStatus: 'NOT_APPLICABLE' });
  expect(r.headers['cache-control']).toBe('private, no-store, max-age=0'); expect(r.headers.vary).toContain('Authorization');
  expect(after.payments).toHaveLength(1); expect(after.payments[0]).toMatchObject({ provider: 'INTERNAL_ZERO', method: 'ZERO_TOTAL', status: 'SUCCEEDED', gatewayAttemptId: null, failureCode: null });
  expect(after.payments[0].amount.toFixed(0)).toBe('0'); expect(after.payments[0].confirmedAt).toEqual(after.order.paidAt); expect(after.order.paidAt).toBeInstanceOf(Date);
  expect(after.order.version).toBe(before.order.version + 1); expect(after.order.items).toEqual(before.order.items); expect(after.stock).toEqual(before.stock);
  expect(after.awards).toHaveLength(1); expect(after.awards[0]).toMatchObject({ points: 0, reversedAt: null });
  const earns = after.journal.filter(e => e.kind === 'EARN'); expect(earns).toHaveLength(1); expect(earns[0]).toMatchObject({ points: 0, availableDelta: 0, reservedDelta: 0, debtDelta: 0n, paymentId: after.payments[0].id });
  expect(after.journal.filter(e => e.kind === 'SETTLE')).toHaveLength(points ? 1 : 0); expect(after.journal.filter(e => e.kind === 'RESERVE')).toHaveLength(points ? 1 : 0); expect(after.journal.filter(e => e.kind === 'RELEASE')).toHaveLength(0);
  expect(await proof(f)).toMatchObject({ available: BigInt(1000 - points), reserved: 0n, debt: 0n }); expect(after.cart.items).toHaveLength(0);
  expect(after.attempts).toHaveLength(0); expect(after.receipts).toHaveLength(0); expect(mock).not.toHaveBeenCalled(); expect(outbound).not.toHaveBeenCalled();
  expect(JSON.stringify(r.body)).not.toMatch(/secret|requestHash|paymentUrl|SecureHash|password/i);
});
test('same key replay is byte-stable and never clears repopulated Cart or settles twice', async () => {
  const f = await fixture(), key = randomUUID(), first = await confirm(f, key).send({}).expect(200);
  const cart = await db.cart.findUniqueOrThrow({ where: { userId: f.user } }); await db.cartItem.create({ data: { cartId: cart.id, productId: f.product, size: 'S', qty: 2, configurationKey: `${f.product}:S` } });
  const before = await snapshot(f), replay = await confirm(f, key).send({}).expect(200);
  expect(replay.body).toEqual(first.body); expect(replay.headers['idempotency-replayed']).toBe('true'); expect(await snapshot(f)).toEqual(before); expect(await proof(f)).toMatchObject({ available: 100n, reserved: 0n });
});
test.each([0, 900])('paid cancellation with redemption%i keeps Payment0/paidAt and reverses Award0 without drift', async points => {
  const f = await fixture(points), key = randomUUID(), first = await confirm(f, key).send({}).expect(200), paid = await snapshot(f);
  await app.get(OrderService).transitionOrder(f.order, paid.order.version, 'CANCELLED'); const after = await snapshot(f);
  expect(after.order.status).toBe('CANCELLED'); expect(after.order.paidAt).toEqual(paid.order.paidAt); expect(after.payments).toEqual(paid.payments); expect(after.stock.stock).toBe(10);
  expect(after.awards[0].points).toBe(0); expect(after.awards[0].reversedAt).toBeInstanceOf(Date);
  const reverse = after.journal.filter(e => e.kind === 'REVERSE'); expect(reverse).toHaveLength(1); expect(reverse[0]).toMatchObject({ points: 0, availableDelta: 0, reservedDelta: 0, debtDelta: 0n });
  expect(after.journal.filter(e => e.kind === 'REFUND')).toHaveLength(points ? 1 : 0); expect(await proof(f)).toMatchObject({ available: 1000n, reserved: 0n, debt: 0n });
  await app.get(OrderService).transitionOrder(f.order, after.order.version, 'CANCELLED'); expect(await snapshot(f)).toEqual(after);
  expect((await confirm(f, key).send({}).expect(200)).body).toEqual(first.body); expect(await snapshot(f)).toEqual(after);
  await confirm(f).send({}).expect(409);
});
test('same key/different Order conflicts in PAY_ORDER namespace', async () => {
  const f = await fixture(0), key = randomUUID(); await confirm(f, key).send({}).expect(200);
  const cart = await db.cart.findUniqueOrThrow({ where: { userId: f.user } }); await db.cartItem.create({ data: { cartId: cart.id, productId: f.product, size: 'S', qty: 1, configurationKey: `${f.product}:S` } });
  const second = { ...f, order: await createOrder(f.user, f.product, f.promotion, 0) }, before = await snapshot(second);
  const r = await confirm(second, key).send({}).expect(409); expect(r.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } }); expect(await snapshot(second)).toEqual(before);
});
test.each(['same', 'different'])('concurrent %s keys produce one Payment/Award/EARN and SETTLE', async kind => {
  const f = await fixture(), key = randomUUID(), other = kind === 'same' ? key : randomUUID();
  const r = await Promise.all([confirm(f, key).send({}), confirm(f, other).send({})]); expect(r.some(x => x.status === 200)).toBe(true); expect(r.every(x => [200, 409, 503].includes(x.status))).toBe(true);
  const after = await snapshot(f); expect(after.payments).toHaveLength(1); expect(after.awards).toHaveLength(1); expect(after.journal.filter(e => e.kind === 'EARN')).toHaveLength(1); expect(after.journal.filter(e => e.kind === 'SETTLE')).toHaveLength(1);
  expect(await proof(f)).toMatchObject({ available: 100n, reserved: 0n }); expect(after.stock.stock).toBe(9);
});
test('concurrent unpaid cancellation and confirmation preserve exactly one outcome', async () => {
  const f = await fixture(); const results = await Promise.all([confirm(f).send({}), cancel(f)]);
  expect(results.every(r => [200, 409, 503].includes(r.status))).toBe(true); const after = await snapshot(f);
  if (after.order.status === 'PAID') { expect(after.stock.stock).toBe(9); expect(after.payments).toHaveLength(1); expect(await proof(f)).toMatchObject({ available: 100n, reserved: 0n }); }
  else { expect(after.order.status).toBe('CANCELLED'); expect(after.stock.stock).toBe(10); expect(after.payments).toHaveLength(0); expect(after.awards).toHaveLength(0); expect(await proof(f)).toMatchObject({ available: 1000n, reserved: 0n }); }
});
test('gateway initiation race cannot create Attempt or settle alongside zero confirmation', async () => {
  const f = await fixture(); gateway(); const results = await Promise.all([confirm(f).send({}), initiate(f)]);
  expect(results[0].status).toBe(200); expect([409, 422, 503]).toContain(results[1].status); const after = await snapshot(f);
  expect(after.payments).toHaveLength(1); expect(after.attempts).toHaveLength(0); expect(after.receipts).toHaveLength(0); expect(await proof(f)).toMatchObject({ available: 100n, reserved: 0n });
});
test('Mock payment race cannot create two terminal records or journal effects', async () => {
  const f = await fixture(); mock.mockReturnValue('SUCCESS');
  await Promise.all([confirm(f).send({}), request(app.getHttpServer()).post('/payments').set('Authorization', auth(f.user)).set('Idempotency-Key', randomUUID()).send({ orderId: f.order, method: 'WALLET' })]);
  const after = await snapshot(f); expect(after.payments).toHaveLength(1); expect(after.awards).toHaveLength(1); expect(after.journal.filter(e => e.kind === 'EARN')).toHaveLength(1); expect(await proof(f)).toMatchObject({ available: 100n, reserved: 0n });
});
test('positive total rejects internal path without financial mutations', async () => {
  const f = await fixture(50), before = await snapshot(f); await confirm(f).send({}).expect(422); expect(await snapshot(f)).toEqual(before); expect(mock).not.toHaveBeenCalled();
});
test.each(['UNKNOWN', 'REVIEW', 'RECEIPT'])('gateway %s cannot be bypassed via confirm-zero', async state => {
  const f = await fixture(50); gateway(); const start = await initiate(f).expect(201); const id = (start.body as { attemptId: string }).attemptId;
  if (state === 'UNKNOWN') await db.paymentAttempt.update({ where: { id }, data: { state: 'UNKNOWN' } });
  if (state === 'REVIEW') await db.paymentAttempt.update({ where: { id }, data: { applicationState: 'REVIEW', reviewReason: 'SYNTHETIC_REVIEW' } });
  if (state === 'RECEIPT') {
    const a = await db.paymentAttempt.findUniqueOrThrow({ where: { id } });
    const p = { vnp_TmnCode: 'TEST0001', vnp_TxnRef: a.txnRef, vnp_Amount: '8500000', vnp_ResponseCode: '00', vnp_TransactionStatus: '01', vnp_TransactionNo: '0', vnp_BankCode: 'NCB', vnp_OrderInfo: `Thanh toan BrewLite ${a.txnRef}` };
    await request(app.getHttpServer()).get('/payments/vnpay/ipn?' + canonicalize(p) + '&vnp_SecureHash=' + signParameters(p, secret)).expect(200);
  }
  const before = await snapshot(f); const r = await confirm(f).send({}).expect(409); expect(r.body).toMatchObject({ error: { code: state === 'REVIEW' ? 'PAYMENT_REQUIRES_REVIEW' : 'PAYMENT_PENDING' } }); expect(await snapshot(f)).toEqual(before);
});
test('PAYMENT_FAILED zero stays failed and never reacquires reservation through internal path', async () => {
  const f = await fixture(); mock.mockReturnValue('FAILURE'); await request(app.getHttpServer()).post('/payments').set('Authorization', auth(f.user)).set('Idempotency-Key', randomUUID()).send({ orderId: f.order, method: 'WALLET' }).expect(200);
  const before = await snapshot(f); expect(before.order.status).toBe('PAYMENT_FAILED'); await confirm(f).send({}).expect(409); expect(await snapshot(f)).toEqual(before);
});
test.each(['PAID', 'CANCELLED'])('%s new-key confirmation rejected; approved replay only', async state => {
  const f = await fixture(); if (state === 'PAID') await confirm(f).send({}).expect(200); else await cancel(f).expect(200);
  const before = await snapshot(f); await confirm(f).send({}).expect(409); expect(await snapshot(f)).toEqual(before);
});
test('ownership before replay, DB role authorization, missing/invalid key, unknown Order', async () => {
  const f = await fixture(), other = await fixture(0), before = await snapshot(f), key = randomUUID();
  await request(app.getHttpServer()).post(`/orders/${f.order}/confirm-zero`).send({}).expect(401);
  for (const user of [admin, staff]) await request(app.getHttpServer()).post(`/orders/${f.order}/confirm-zero`).set('Authorization', auth(user)).set('Idempotency-Key', key).send({}).expect(403);
  await request(app.getHttpServer()).post(`/orders/${f.order}/confirm-zero`).set('Authorization', auth(other.user)).set('Idempotency-Key', key).send({}).expect(404);
  await request(app.getHttpServer()).post(`/orders/${f.order}/confirm-zero`).set('Authorization', auth(f.user)).send({}).expect(400);
  await confirm(f, 'has space').send({}).expect(400); await confirm({ ...f, order: randomUUID() }).send({}).expect(404); expect(await snapshot(f)).toEqual(before);
  await confirm(f, key).send({}).expect(200);
  await request(app.getHttpServer()).post(`/orders/${f.order}/confirm-zero`).set('Authorization', auth(other.user)).set('Idempotency-Key', key).send({}).expect(404);
});
test('no live reprice: expired promotion/inactive catalog do not change stored zero settlement', async () => {
  const f = await fixture(); await db.product.update({ where: { id: f.product }, data: { price: '200000', isActive: false } }); await db.promotion.update({ where: { code: f.promotion }, data: { isActive: false } });
  const before = await snapshot(f); await confirm(f).send({}).expect(200); const after = await snapshot(f); expect(after.order.items).toEqual(before.order.items); expect(after.order.total.toFixed(0)).toBe('0'); expect(after.stock).toEqual(before.stock);
});
test('purchased quantity is removed once while extra quantity and unrelated Cart items remain', async () => {
  const f = await fixture(), cart = await db.cart.findUniqueOrThrow({ where: { userId: f.user } });
  await db.cartItem.updateMany({ where: { cartId: cart.id }, data: { qty: 3 } });
  const product = await db.product.create({ data: { name: 'Extra isolated item', imageUrl: '/fixture', price: '10000', stock: 4, sizes: { create: { size: 'S', extraPrice: '0' } } } });
  await db.cartItem.create({ data: { cartId: cart.id, productId: product.id, size: 'S', configurationKey: `${product.id}:S`, qty: 1 } });
  await confirm(f).send({}).expect(200); const after = await snapshot(f); expect(after.cart.items.find(i => i.productId === f.product)?.qty).toBe(2); expect(after.cart.items.find(i => i.productId === product.id)?.qty).toBe(1);
});
test('inconsistent snapshot/Cart rejects before settlement and no orphan claim', async () => {
  const f = await fixture(); await db.orderItem.updateMany({ where: { orderId: f.order }, data: { basePrice: '99999' } }); const before = await snapshot(f);
  await confirm(f).send({}).expect(503); expect(await snapshot(f)).toEqual(before);
});
test.each(['payments', 'loyalty_awards', 'loyalty_entries', 'carts', 'idempotency_requests'])('fault at %s rolls back Payment0/Award0/EARN0/Cart/claim atomically', async table => {
  const f = await fixture(), before = await snapshot(f), name = 'fault_' + randomUUID().replaceAll('-', '');
  const condition = table === 'carts' ? `NEW.user_id='${f.user}'::uuid` : table === 'idempotency_requests' ? `NEW.order_id='${f.order}'::uuid AND NEW.state='COMPLETED'` : `NEW.order_id='${f.order}'::uuid`;
  await client.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'Synthetic rollback fault'; END IF; RETURN NEW; END $$`);
  await client.query(`CREATE TRIGGER ${name} AFTER INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try { await confirm(f).send({}).expect(503); expect(await snapshot(f)).toEqual(before); expect(await proof(f)).toMatchObject({ available: 100n, reserved: 900n, debt: 0n }); }
  finally { await client.query(`DROP TRIGGER ${name} ON ${table}`); await client.query(`DROP FUNCTION ${name}()`); }
  await confirm(f).send({}).expect(200); expect(await proof(f)).toMatchObject({ available: 100n, reserved: 0n });
});
async function debt(f: Fixture, points: number) {
  const legacy = await db.order.create({ data: { userId: f.user, orderCode: randomUUID(), status: 'PAID', paidAt: new Date(), subtotal: points * 10000, total: points * 10000 } });
  await db.loyaltyAward.create({ data: { userId: f.user, orderId: legacy.id, points, createdAt: new Date('2020-01-01') } });
  await app.get(OrderService).transitionOrder(legacy.id, legacy.version, 'CANCELLED');
}
test('outstanding debt blocks positive redemption confirmation with no financial writes', async () => {
  const f = await fixture(); await debt(f, 200); const before = await snapshot(f);
  const r = await confirm(f).send({}).expect(409); expect(r.body).toMatchObject({ error: { code: 'LOYALTY_REVERSAL_OUTSTANDING' } }); expect(await snapshot(f)).toEqual(before); expect(await proof(f)).toMatchObject({ available: 0n, reserved: 900n, debt: 100n });
});
test('EARN0 and paid REVERSE0 leave existing debt untouched for zero-redemption order', async () => {
  const f = await fixture(0, 0); await debt(f, 20); await confirm(f).send({}).expect(200); expect(await proof(f)).toMatchObject({ available: 0n, reserved: 0n, debt: 20n });
  const paid = await snapshot(f); await app.get(OrderService).transitionOrder(f.order, paid.order.version, 'CANCELLED'); expect(await proof(f)).toMatchObject({ available: 0n, reserved: 0n, debt: 20n });
});
test('Mock and ZERO_COMPLETE_V1 hashes conflict safely in existing PAY_ORDER namespace', async () => {
  const f = await fixture(0), key = randomUUID(); mock.mockReturnValue('SUCCESS');
  await request(app.getHttpServer()).post('/payments').set('Authorization', auth(f.user)).set('Idempotency-Key', key).send({ orderId: f.order, method: 'WALLET' }).expect(200);
  const before = await snapshot(f), r = await confirm(f, key).send({}).expect(409);
  expect(r.body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } }); expect(await snapshot(f)).toEqual(before);
  expect(before.payments[0].provider).toBe('MOCK'); expect(await proof(f)).toMatchObject({ available: 1000n, reserved: 0n });
});
test('CREATE_ORDER key can also identify PAY_ORDER confirmation without rewriting original claim', async () => {
  const f = await fixture(), original = await db.idempotencyRequest.findFirstOrThrow({ where: { orderId: f.order, operation: 'CREATE_ORDER' } });
  await confirm(f, original.idempotencyKey).send({}).expect(200);
  expect(await db.idempotencyRequest.findUnique({ where: { id: original.id } })).toEqual(original);
  expect(await db.idempotencyRequest.count({ where: { userId: f.user, idempotencyKey: original.idempotencyKey } })).toBe(2);
});
test('missing purchased Cart item rejects with no partial Payment/Award/claim or points movement', async () => {
  const f = await fixture(), cart = await db.cart.findUniqueOrThrow({ where: { userId: f.user } });
  await db.cartItem.deleteMany({ where: { cartId: cart.id } }); const before = await snapshot(f);
  await confirm(f).send({}).expect(503); expect(await snapshot(f)).toEqual(before); expect(await proof(f)).toMatchObject({ available: 100n, reserved: 900n });
});

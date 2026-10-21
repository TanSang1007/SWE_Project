import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { configureApp } from '../../src/common/configure-app';
import { utcConnectionString } from '../../src/database/pg-connection';
import { initiationSettings } from '../../src/payments/vnpay/initiation-config';
import { SANDBOX_PAYMENT_URL } from '../../src/payments/vnpay/vnpay-config';
import { buildPaymentUrl, toVnpayAmount } from '../../src/payments/vnpay/vnpay-pay';
import { canonicalize, signParameters } from '../../src/payments/vnpay/vnpay-signing';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !/^\/brewlite_b2a_[a-f0-9]{12}_test$/.test(new URL(connectionString).pathname)
  || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname)) throw Error('Isolated synthetic database required');
const schema = `minimum_${randomUUID().replaceAll('-', '')}`, url = new URL(connectionString);
url.searchParams.set('options', `-c search_path=${schema}`);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(url.toString()) }, { schema }) });
const client = new Client({ connectionString });
const secret = 'synthetic-b2a-minimum-fixture-only';
const settings = new ConfigService({ JWT_SECRET: 'synthetic-minimum-jwt-fixture-at-least-32-bytes', JWT_EXPIRES_IN: 3600, PAYMENT_MOCK_MODE: 'SUCCESS',
  ...initiationSettings({ NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_TEST_ONLY: 'true', DATABASE_URL: connectionString, TEST_DATABASE_URL: connectionString,
    VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
    VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' }) });
let app: NestExpressApplication, jwt: JwtService;
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).overrideProvider(ConfigService).useValue(settings).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
});
beforeEach(() => settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'));
afterAll(async () => { if (app) await app.close(); await db.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
async function fixture(final: number, discount = 0, points = 0) {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'synthetic-only', loyaltyPoints: 100 } });
  await db.loyaltyEntry.create({ data: { userId: user.id, kind: 'OPENING', points: 100, availableDelta: 100, reservedDelta: 0, debtDelta: 0n, effectKey: `OPENING:${user.id}` } });
  const price = final + discount + points * 100;
  const product = await db.product.create({ data: { name: 'Minimum fixture', price: String(price), stock: 10, imageUrl: '/fixture', sizes: { create: { size: 'S', extraPrice: '0' } } } });
  await db.cart.create({ data: { userId: user.id, items: { create: { productId: product.id, size: 'S', qty: 1, configurationKey: `${product.id}:S` } } } });
  const promotion = discount ? await db.promotion.create({ data: { code: 'M' + randomUUID().replaceAll('-', '').slice(0, 15).toUpperCase(), discountAmount: String(discount), minimumSubtotal: '0', isActive: true, startsAt: new Date('2020-01-01'), endsAt: new Date('2099-01-01') } }) : null;
  return { user: user.id, product: product.id, auth: `Bearer ${jwt.sign({ sub: user.id })}`, key: randomUUID(), input: { items: [{ productId: product.id, size: 'S', qty: 1, toppingIds: [] }], redeemedPoints: points, ...(promotion ? { promotionCode: promotion.code } : {}) } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = (f: Fixture, key: string = f.key, input: object = f.input) => request(app.getHttpServer()).post('/orders').set('Authorization', f.auth).set('Idempotency-Key', key).send(input);
const initiate = (f: Fixture, orderId: string, key: string = randomUUID()) => request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', f.auth).set('Idempotency-Key', key).send({ orderId });
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const { tablename } of (await client.query<{ tablename: string }>('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', [schema])).rows)
    result[tablename] = (await client.query(`SELECT count(*)::int count,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) hash FROM "${schema}"."${tablename}" t`)).rows;
  return result;
}
test.each([0, 1, 4999, 5000, 5001, 85000])('server final amount %s respects minimum and rolls back rejected state', async amount => {
  const f = await fixture(amount), before = await snapshot(), r = await create(f);
  if (amount > 0 && amount < 5000) { expect(r.status).toBe(422); expect(r.body as unknown).toMatchObject({ error: { code: 'VNPAY_MINIMUM_AMOUNT_NOT_MET' } }); expect(await snapshot()).toEqual(before); }
  else { expect(r.status).toBe(201); expect(r.body as unknown).toMatchObject({ total: String(amount) }); expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(9); }
});
test.each([[1, 5000, 0], [4999, 0, 50], [4999, 10000, 50], [5000, 10000, 50], [0, 10000, 50], [0, 10000, 0], [0, 0, 50]])('pricing final%s promotion%s points%s is checked after all discounts', async (final, discount, points) => {
  const f = await fixture(final, discount, points), before = await snapshot(), r = await create(f);
  if (final > 0 && final < 5000) { expect(r.status).toBe(422); expect(await snapshot()).toEqual(before); }
  else { expect(r.status).toBe(201); expect(r.body as unknown).toMatchObject({ total: String(final), redeemedPoints: points });
    if (final === 0) { const order = r.body as { id: string }; const done = await request(app.getHttpServer()).post(`/orders/${order.id}/confirm-zero`).set('Authorization', f.auth).set('Idempotency-Key', randomUUID()).send({}).expect(200); expect(done.body as unknown).toMatchObject({ payment: { amount: '0', provider: 'INTERNAL_ZERO' }, loyalty: { awardedPoints: 0 } }); expect(await db.paymentAttempt.count({ where: { orderId: order.id } })).toBe(0); }
  }
});
test('concurrent rejected same-key requests leave every table unchanged; correction may reuse rolled-back key', async () => {
  const f = await fixture(4900, 0, 1), before = await snapshot();
  const results = await Promise.all([create(f), create(f)]); expect(results.map(r => r.status)).toEqual([422, 422]); expect(await snapshot()).toEqual(before);
  const input = { ...f.input, redeemedPoints: 0 }; const r = await create(f, f.key, input).expect(201); expect(r.body as unknown).toMatchObject({ total: '5000' });
  const after = await snapshot(); await create(f, f.key, input).expect(201); expect(await snapshot()).toEqual(after);
});
test('concurrent eligible same-key creates reserve once', async () => {
  const f = await fixture(5000, 10000, 10), rs = await Promise.all([create(f), create(f)]);
  expect(rs.map(r => r.status)).toEqual([201, 201]); expect((rs[0].body as { id: string }).id).toBe((rs[1].body as { id: string }).id);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(9);
  expect(await db.loyaltyEntry.count({ where: { userId: f.user, kind: 'RESERVE' } })).toBe(1);
});
test.each([4999, 5000])('current size and topping prices participate in server final total%s', async final => {
  const f = await fixture(final - 2);
  await db.productSize.update({ where: { productId_size: { productId: f.product, size: 'S' } }, data: { extraPrice: '1' } });
  const topping = await db.topping.create({ data: { name: 'Minimum topping', price: '1' } });
  await db.productTopping.create({ data: { productId: f.product, toppingId: topping.id } });
  const item = await db.cartItem.findFirstOrThrow({ where: { cart: { userId: f.user } } });
  await db.cartItem.update({ where: { id: item.id }, data: { configurationKey: `${f.product}:S:${topping.id}`, toppings: { create: { toppingId: topping.id } } } });
  const input = { ...f.input, items: [{ ...f.input.items[0], toppingIds: [topping.id] }] }, before = await snapshot();
  const r = await create(f, f.key, input).expect(final < 5000 ? 422 : 201);
  if (final < 5000) expect(await snapshot()).toEqual(before);
  else expect(r.body as unknown).toMatchObject({ total: '5000' });
});
test('different-key concurrent creation cannot double-reserve eligible resources', async () => {
  const f = await fixture(5000, 0, 10), rs = await Promise.all([create(f), create(f, randomUUID())]);
  expect(rs.map(r => r.status).sort()).toEqual([201, 409]);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(9);
  expect(await db.loyaltyEntry.count({ where: { userId: f.user, kind: 'RESERVE' } })).toBe(1);
});
test('missing selected VNPAY configuration fails closed and rolls back creation', async () => {
  const f = await fixture(5000), before = await snapshot(), original = settings.get<unknown>('VNPAY_INITIATION_CONFIG');
  settings.set('VNPAY_INITIATION_CONFIG', null);
  try { await create(f).expect(503); expect(await snapshot()).toEqual(before); }
  finally { settings.set('VNPAY_INITIATION_CONFIG', original); }
});
test.each([1, 4999])('historical MOCK Order%s remains readable/replayable but new VNPAY initiation fails without effects', async amount => {
  const f = await fixture(amount); settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); const r = await create(f).expect(201); const order = r.body as { id: string };
  settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'); const before = await snapshot();
  await request(app.getHttpServer()).get(`/orders/${order.id}`).set('Authorization', f.auth).expect(200);
  const replay = await create(f).expect(201); expect(replay.body as unknown).toEqual(r.body); expect(replay.headers['idempotency-replayed']).toBe('true');
  const rejected = await initiate(f, order.id).expect(422); expect(rejected.body as unknown).toMatchObject({ error: { code: 'VNPAY_MINIMUM_AMOUNT_NOT_MET' } }); expect(await snapshot()).toEqual(before);
});
async function historicalAttempt(f: Fixture, orderId: string) {
  const amount = (await db.order.findUniqueOrThrow({ where: { id: orderId } })).total.toFixed(0), ref = randomUUID().replaceAll('-', ''), key = randomUUID();
  const now = new Date('2026-10-18T01:00:00Z'), expiresAt = new Date('2099-01-01T00:00:00Z');
  const paymentUrl = buildPaymentUrl(settings.getOrThrow('VNPAY_INITIATION_CONFIG'), { orderTotalVnd: amount, txnRef: ref, createDate: '20261018080000', expireDate: '20990101070000', customerIp: '127.0.0.1' });
  const params = Object.fromEntries(new URL(paymentUrl).searchParams); delete params.vnp_SecureHash;
  return db.$transaction(async tx => {
    const claim = await tx.idempotencyRequest.create({ data: { userId: f.user, operation: 'PAY_ORDER', idempotencyKey: key, requestHash: createHash('sha256').update(JSON.stringify({ action: 'VNPAY_INITIATE_V1', orderId })).digest('hex'), state: 'PROCESSING' } });
    const attempt = await tx.paymentAttempt.create({ data: { orderId, idempotencyRequestId: claim.id, merchantCode: 'TEST0001', txnRef: ref, amount, createDate: '20261018080000', expiresAt, createdAt: now, requestParameters: params } });
    const body = { attemptId: attempt.id, orderId, provider: 'VNPAY_SANDBOX', amount, currency: 'VND', state: 'AWAITING', paymentUrl, expiresAt: expiresAt.toISOString() };
    await tx.idempotencyRequest.update({ where: { id: claim.id }, data: { orderId, state: 'COMPLETED', responseStatus: 201, responseBody: body, completedAt: now } });
    return { attempt, key, body, params, ref, amount };
  });
}
function callback(a: Awaited<ReturnType<typeof historicalAttempt>>, success = true) {
  const fields = { vnp_TmnCode: 'TEST0001', vnp_TxnRef: a.ref, vnp_Amount: toVnpayAmount(a.amount), vnp_OrderInfo: a.params.vnp_OrderInfo, vnp_ResponseCode: success ? '00' : '24', vnp_TransactionStatus: success ? '00' : '02', vnp_TransactionNo: success ? '1234567' : '0', vnp_BankCode: 'NCB', vnp_PayDate: '20261018080500' };
  return canonicalize(fields) + '&vnp_SecureHash=' + signParameters(fields, secret);
}
test('historical under-minimum Attempt exact replay preserves URL/ref/expiry; authentic callback still settles once', async () => {
  const f = await fixture(4999); settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); const r = await create(f).expect(201), orderId = (r.body as { id: string }).id;
  settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'); const a = await historicalAttempt(f, orderId), before = await snapshot();
  const replay = await initiate(f, orderId, a.key).expect(201); expect(replay.body as unknown).toEqual(a.body); expect(await snapshot()).toEqual(before);
  const status = await request(app.getHttpServer()).get(`/payments/attempts/${a.attempt.id}`).set('Authorization', f.auth).expect(200); expect(status.body as unknown).toMatchObject({ canResume: false, canRetry: false });
  const raw = callback(a); const ipn = await request(app.getHttpServer()).get('/payments/vnpay/ipn?' + raw).expect(200); expect(ipn.body as unknown).toMatchObject({ RspCode: '00' });
  const after = await snapshot(); await request(app.getHttpServer()).get('/payments/vnpay/ipn?' + raw).expect(200); expect(await snapshot()).toEqual(after);
});
test('historical verified failed under-minimum retry cannot reacquire resources', async () => {
  const f = await fixture(4999, 0, 1); settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); const r = await create(f).expect(201), orderId = (r.body as { id: string }).id;
  settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'); const a = await historicalAttempt(f, orderId);
  const ipn = await request(app.getHttpServer()).get('/payments/vnpay/ipn?' + callback(a, false)).expect(200); expect(ipn.body as unknown).toMatchObject({ RspCode: '00' });
  const before = await snapshot(); await initiate(f, orderId).expect(422); expect(await snapshot()).toEqual(before);
  const status = await request(app.getHttpServer()).get(`/payments/attempts/${a.attempt.id}`).set('Authorization', f.auth); expect(status.body as unknown).toMatchObject({ canRetry: false, canCancel: true, effectiveState: 'FAILED' });
});
test.each(['UNKNOWN', 'REVIEW'])('historical %s cannot bypass existing financial guards', async state => {
  const f = await fixture(4999); settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); const r = await create(f).expect(201), orderId = (r.body as { id: string }).id;
  settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'); const a = await historicalAttempt(f, orderId);
  await db.paymentAttempt.update({ where: { id: a.attempt.id }, data: state === 'REVIEW' ? { applicationState: 'REVIEW', reviewReason: 'SYNTHETIC_HISTORY' } : { state: 'UNKNOWN' } });
  const before = await snapshot(); const denied = await initiate(f, orderId).expect(409); expect(denied.body as unknown).toMatchObject({ error: { code: state === 'REVIEW' ? 'PAYMENT_REQUIRES_REVIEW' : 'PAYMENT_PENDING' } }); expect(await snapshot()).toEqual(before);
});
test('client body/query/header cannot select provider; MOCK payment below minimum stays unchanged', async () => {
  const f = await fixture(1), before = await snapshot();
  await create(f, f.key, { ...f.input, provider: 'MOCK' }).expect(400);
  await request(app.getHttpServer()).post('/orders?provider=MOCK').set('Authorization', f.auth).set('Idempotency-Key', f.key).send(f.input).expect(400);
  await create(f).set('X-Payment-Provider', 'MOCK').expect(422); expect(await snapshot()).toEqual(before);
  settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); const order = await create(f).expect(201);
  await request(app.getHttpServer()).post('/payments').set('Authorization', f.auth).set('Idempotency-Key', randomUUID()).send({ orderId: (order.body as { id: string }).id, method: 'CARD' }).expect(200);
});

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
import { PrismaClient } from '../../src/generated/prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { configureApp } from '../../src/common/configure-app';
import { utcConnectionString } from '../../src/database/pg-connection';
import { initiationSettings } from '../../src/payments/vnpay/initiation-config';
import { SANDBOX_PAYMENT_URL } from '../../src/payments/vnpay/vnpay-config';
import { toVnpayAmount } from '../../src/payments/vnpay/vnpay-pay';
import { canonicalize, signParameters } from '../../src/payments/vnpay/vnpay-signing';
import { IpnService } from '../../src/payments/ipn.service';
import { SandboxProfileService } from '../../src/payments/sandbox-profile.service';
import { QUERYDR_TRANSPORT, disabledQueryDrTransport } from '../../src/payments/vnpay/querydr-transport';
import { reconcileAccount } from '../../src/loyalty/loyalty-accounting';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !/^\/brewlite_b2a_[a-f0-9]{12}_test$/.test(new URL(connectionString).pathname)
  || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname)) throw Error('Isolated synthetic database required');
const schema = `drain_${randomUUID().replaceAll('-', '')}`, url = new URL(connectionString);
url.searchParams.set('options', `-c search_path=${schema}`);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(url.toString()) }, { schema }) });
const client = new Client({ connectionString });
const secret = 'synthetic-b2a-minimum-fixture-only';
const settings = new ConfigService({ NODE_ENV: 'development', FRONTEND_ORIGIN: 'http://localhost:3000', JWT_SECRET: 'synthetic-minimum-jwt-fixture-at-least-32-bytes', JWT_EXPIRES_IN: 3600, PAYMENT_MOCK_MODE: 'SUCCESS',
  ...initiationSettings({ NODE_ENV: 'development', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_SANDBOX_ENABLED: 'true', VNPAY_ACCEPT_NEW_PAYMENTS: 'true', DATABASE_URL: connectionString, TEST_DATABASE_URL: connectionString,
    VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
    VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' }) });
let app: NestExpressApplication, jwt: JwtService;
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  await restart();
});
beforeEach(() => { settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'); settings.set('VNPAY_ACCEPT_NEW_PAYMENTS', true); });
afterEach(() => jest.restoreAllMocks());
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

async function restart() { if(app) await app.close();
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).overrideProvider(ConfigService).useValue(settings).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
}
function callback(a: { ref: string; amount: string; params: Record<string, string> }, success = true) {
  const fields = { vnp_TmnCode: 'TEST0001', vnp_TxnRef: a.ref, vnp_Amount: toVnpayAmount(a.amount), vnp_OrderInfo: a.params.vnp_OrderInfo, vnp_ResponseCode: success ? '00' : '24', vnp_TransactionStatus: success ? '00' : '02', vnp_TransactionNo: success ? (BigInt('0x' + a.ref.slice(0, 12)) + 1n).toString() : '0', vnp_BankCode: 'NCB', vnp_PayDate: '20261018080500' };
  return canonicalize(fields) + '&vnp_SecureHash=' + signParameters(fields, secret);
}

const drain = () => settings.set('VNPAY_ACCEPT_NEW_PAYMENTS', false);
async function started(amount = 85000, points = 10) {
  const f = await fixture(amount, 0, points), r = await create(f).expect(201), orderId = (r.body as { id: string }).id;
  const key = randomUUID(), initiated = await initiate(f, orderId, key).expect(201);
  const body = initiated.body as { attemptId: string; paymentUrl: string };
  const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: body.attemptId } });
  const params = attempt.requestParameters as Record<string, string>;
  return { f, orderId, key, body, a: { attempt, key, body, params, ref: attempt.txnRef, amount: attempt.amount.toFixed(0) } };
}
const ipn = (raw: string) => request(app.getHttpServer()).get('/payments/vnpay/ipn?' + raw).expect(200);
function event(a: Parameters<typeof callback>[0], override: Record<string, string>) {
  const p = Object.fromEntries(new URLSearchParams(callback(a))); delete p.vnp_SecureHash;
  Object.assign(p, override); return canonicalize(p) + '&vnp_SecureHash=' + signParameters(p, secret);
}
test.each([0, 1, 4999, 5000])('accepting-new validates server total%s', async amount => {
  const f = await fixture(amount), before = await snapshot(), r = await create(f);
  expect(r.status).toBe(amount > 0 && amount < 5000 ? 422 : 201);
  if (r.status === 422) expect(await snapshot()).toEqual(before);
});
test.each([0, 1, 4999, 5000])('drain validates server total%s without unsafe reservation', async amount => {
  const f = await fixture(amount); drain(); const before = await snapshot(), r = await create(f);
  expect(r.status).toBe(amount === 0 ? 201 : amount < 5000 ? 422 : 503);
  if (amount > 0) expect(await snapshot()).toEqual(before);
  else {
    const id = (r.body as { id: string }).id;
    await initiate(f, id).expect(422);
    await request(app.getHttpServer()).post(`/orders/${id}/confirm-zero`).set('Authorization', f.auth).set('Idempotency-Key', randomUUID()).send({}).expect(200);
  }
});
test('drain rejects new initiation on a pre-existing eligible Order; exact create replay remains unchanged', async () => {
  const f = await fixture(5000), r = await create(f).expect(201); drain(); const before = await snapshot();
  const replay = await create(f).expect(201); expect(replay.body as unknown).toEqual(r.body);
  const denied = await initiate(f, (r.body as { id: string }).id).expect(503); expect(denied.body as unknown).toMatchObject({ error: { code: 'PAYMENT_ADMISSION_CLOSED' } });
  expect(await snapshot()).toEqual(before);
});
test('restart drain keeps profile and exact Attempt replay/status; valid signed IPN settles once', async () => {
  const s = await started(); drain(); const before = await snapshot(); await restart(); expect(await snapshot()).toEqual(before);
  const replay = await initiate(s.f, s.orderId, s.key).expect(201); expect(replay.body as unknown).toEqual(s.body); expect(await snapshot()).toEqual(before);
  const status = await request(app.getHttpServer()).get(`/payments/attempts/${s.a.attempt.id}`).set('Authorization', s.f.auth).expect(200);
  expect(status.body as unknown).toMatchObject({ canResume: false, canRetry: false, effectiveState: 'AWAITING' });
  const raw = callback(s.a); expect((await ipn(raw)).body as unknown).toMatchObject({ RspCode: '00' });
  const after = await snapshot(); expect((await ipn(raw)).body as unknown).toMatchObject({ RspCode: '02' }); expect(await snapshot()).toEqual(after);
  expect(await db.payment.count({ where: { orderId: s.orderId } })).toBe(1); expect(await db.loyaltyAward.count({ where: { orderId: s.orderId } })).toBe(1);
  expect((await db.product.findUniqueOrThrow({ where: { id: s.f.product } })).stock).toBe(9);
});
test('signed decline during drain releases once; retry disabled, historical status/cancel safe', async () => {
  const s = await started(); drain(); const raw = callback(s.a, false); expect((await ipn(raw)).body as unknown).toMatchObject({ RspCode: '00' });
  const after = await snapshot(); await ipn(raw); expect(await snapshot()).toEqual(after);
  await initiate(s.f, s.orderId).expect(503); expect(await snapshot()).toEqual(after);
  const status = await request(app.getHttpServer()).get(`/payments/attempts/${s.a.attempt.id}`).set('Authorization', s.f.auth).expect(200);
  expect(status.body as unknown).toMatchObject({ canRetry: false, canCancel: true, effectiveState: 'FAILED' });
  expect((await db.product.findUniqueOrThrow({ where: { id: s.f.product } })).stock).toBe(10);
});
test.each(['signature', 'merchant', 'amount', 'reference'])('drain rejects wrong%s without financial or receipt writes', async kind => {
  const s = await started(); drain(); let raw = callback(s.a), expected = '97';
  if (kind === 'signature') raw = raw.slice(0, -1) + (raw.endsWith('a') ? 'b' : 'a');
  if (kind === 'merchant') raw = event(s.a, { vnp_TmnCode: 'OTHER001' });
  if (kind === 'amount') { raw = event(s.a, { vnp_Amount: '8500001' }); expected = '04'; }
  if (kind === 'reference') { raw = event(s.a, { vnp_TxnRef: randomUUID().replaceAll('-', '') }); expected = '01'; }
  const before = await snapshot(); expect((await ipn(raw)).body as unknown).toMatchObject({ RspCode: expected }); expect(await snapshot()).toEqual(before);
});
test.each(['UNKNOWN', 'REVIEW'])('drain preserves%s and reservations, without unsafe retry or cancellation', async state => {
  const s = await started(); drain();
  const raw = event(s.a, state === 'UNKNOWN' ? { vnp_ResponseCode: '00', vnp_TransactionStatus: '01' } : { vnp_ResponseCode: '07', vnp_TransactionStatus: '07' });
  expect((await ipn(raw)).body as unknown).toMatchObject({ RspCode: state === 'UNKNOWN' ? '99' : '00' });
  const before = await snapshot(); await initiate(s.f, s.orderId).expect(409);
  await request(app.getHttpServer()).post(`/orders/${s.orderId}/cancel`).set('Authorization', s.f.auth).expect(409);
  expect(await snapshot()).toEqual(before);
  expect((await db.product.findUniqueOrThrow({ where: { id: s.f.product } })).stock).toBe(9);
});
test('Return after drain and signed success remains strictly read-only; status is owner-authorized', async () => {
  const s = await started(); drain(); const before = await snapshot();
  const r = await request(app.getHttpServer()).get('/payments/vnpay/return?' + callback(s.a)).expect(303);
  expect(r.headers.location).toContain('http://localhost:3000/payments/vnpay/result?attemptId='); expect(await snapshot()).toEqual(before);
  await request(app.getHttpServer()).get(`/payments/attempts/${s.a.attempt.id}`).expect(401);
  const other = await fixture(5000); await request(app.getHttpServer()).get(`/payments/attempts/${s.a.attempt.id}`).set('Authorization', other.auth).expect(404);
});
test('restart after T1 commit/T2 failure recovers durable receipt under drain, once', async () => {
  const s = await started(); jest.spyOn(app.get(IpnService), 'apply').mockRejectedValueOnce(Error('synthetic crash'));
  const raw = callback(s.a); expect((await ipn(raw)).body as unknown).toMatchObject({ RspCode: '99' });
  expect(await db.payment.count({ where: { orderId: s.orderId } })).toBe(0);
  expect(await db.paymentVerification.count({ where: { attemptId: s.a.attempt.id, state: 'VERIFIED', processedAt: null } })).toBe(1);
  drain(); await restart(); expect((await ipn(raw)).body as unknown).toMatchObject({ RspCode: '00' });
  const after = await snapshot(); await ipn(raw); expect(await snapshot()).toEqual(after);
});
test.each(['merchant', 'callback', 'missing'])('incompatible%s verification profile cannot pass restart preflight; rows preserved', async change => {
  await started(); drain(); const before = await snapshot(), original = settings.getOrThrow<Record<string, unknown>>('VNPAY_INITIATION_CONFIG');
  settings.set('VNPAY_INITIATION_CONFIG', change === 'missing' ? null : change === 'merchant' ? { ...original, merchantCode: 'OTHER001' }
    : { ...original, returnUrl: 'https://different.example.org/payments/vnpay/return', ipnUrl: 'https://different.example.org/payments/vnpay/ipn' });
  try { await expect(app.get(SandboxProfileService).onApplicationBootstrap()).rejects.toThrow('Sandbox verification profile unavailable'); expect(await snapshot()).toEqual(before); }
  finally { settings.set('VNPAY_INITIATION_CONFIG', original); }
});
test('changed key cannot authenticate an old callback; retaining the original key restores safe drain', async () => {
  const s = await started(); drain(); const original = settings.getOrThrow<Record<string, unknown>>('VNPAY_INITIATION_CONFIG'), before = await snapshot();
  settings.set('VNPAY_INITIATION_CONFIG', { ...original, hashSecret: 'synthetic-b2a-wrong-key' });
  try { expect((await ipn(callback(s.a))).body as unknown).toMatchObject({ RspCode: '97' }); expect(await snapshot()).toEqual(before); }
  finally { settings.set('VNPAY_INITIATION_CONFIG', original); }
  await restart(); expect((await ipn(callback(s.a))).body as unknown).toMatchObject({ RspCode: '00' });
});
test('drain config is a private additive hint, never MOCK; external QueryDr remains disabled', async () => {
  drain(); const f = await fixture(5000), r = await request(app.getHttpServer()).get('/payments/config').set('Authorization', f.auth).expect(200);
  expect(r.body as unknown).toEqual({ providerMode: 'VNPAY_SANDBOX', acceptingNewPayments: false }); expect(r.headers['cache-control']).toContain('no-store');
  expect(app.get(QUERYDR_TRANSPORT)).toBe(disabledQueryDrTransport);
  await request(app.getHttpServer()).get('/payments/config?acceptingNewPayments=true').set('Authorization', f.auth).expect(400);
  const before = await snapshot(); await create(f).set('X-VNPAY-Accept-New-Payments', 'true').expect(503); expect(await snapshot()).toEqual(before);
});

test('normal Sandbox accepts consecutive purchases and independent customers after verified cancellation, with exact effects', async () => {
  const s = await started(40000, 0);
  expect((await ipn(callback(s.a, false))).body as unknown).toMatchObject({ RspCode: '00' });
  const cancelled = await request(app.getHttpServer()).get(`/payments/attempts/${s.a.attempt.id}`).set('Authorization', s.f.auth).expect(200);
  expect(cancelled.body as unknown).toMatchObject({ effectiveState:'FAILED', failureReason:'CUSTOMER_CANCELLED', canRetry:true, canCancel:true });
  await request(app.getHttpServer()).post(`/orders/${s.orderId}/cancel`).set('Authorization', s.f.auth).expect(200);
  await initiate(s.f, s.orderId).expect(409);
  const intents: string[] = [s.key];
  for (let cycle = 0; cycle < 2; cycle++) {
    if (cycle > 0) await db.cartItem.create({ data:{ cartId:(await db.cart.findUniqueOrThrow({where:{userId:s.f.user}})).id,productId:s.f.product,size:'S',qty:1,configurationKey:`${s.f.product}:S` } });
    const created = await create(s.f, randomUUID()).expect(201), id = (created.body as {id:string}).id, key = randomUUID(); intents.push(key);
    const results = await Promise.all([initiate(s.f,id,key),initiate(s.f,id,key)]);
    expect(results.some(r=>r.status===201)).toBe(true);
    expect(results.every(r=>r.status===201||r.status===409)).toBe(true);
    await initiate(s.f,id,key).expect(201);
    const attempt = await db.paymentAttempt.findFirstOrThrow({where:{orderId:id}});
    expect(await db.paymentAttempt.count({where:{orderId:id}})).toBe(1);
    const raw=callback({ref:attempt.txnRef,amount:attempt.amount.toFixed(0),params:attempt.requestParameters as Record<string,string>});
    expect((await ipn(raw)).body as unknown).toMatchObject({RspCode:'00'});
    const after=await snapshot();await ipn(raw);expect(await snapshot()).toEqual(after);
    await initiate(s.f,id).expect(409);
    expect((await db.order.findUniqueOrThrow({where:{id}})).status).toBe('PAID');
    expect(await db.payment.count({where:{orderId:id,status:'SUCCEEDED'}})).toBe(1);
    expect(await db.loyaltyAward.count({where:{orderId:id}})).toBe(1);
    expect((await db.loyaltyAward.findUniqueOrThrow({where:{orderId:id}})).points).toBe(4);
    expect((await db.product.findUniqueOrThrow({where:{id:s.f.product}})).stock).toBe(9-cycle);
    expect((await request(app.getHttpServer()).get('/payments/config').set('Authorization',s.f.auth).expect(200)).body as unknown).toEqual({providerMode:'VNPAY_SANDBOX'});
  }
  expect(new Set(intents).size).toBe(3);
  const other=await started(40000,0);expect((await ipn(callback(other.a))).body as unknown).toMatchObject({RspCode:'00'});
  const rollback=Error('read-only rollback');
  try {await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');await reconcileAccount(tx,s.f.user);await reconcileAccount(tx,other.f.user);throw rollback;});}
  catch(error){if(error!==rollback)throw error;}
});

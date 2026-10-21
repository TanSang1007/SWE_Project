import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { utcConnectionString } from '../../src/database/pg-connection';
import { configureApp } from '../../src/common/configure-app';
import { createCallbackIngress } from '../../src/callback-ingress/server';
import { initiationSettings } from '../../src/payments/vnpay/initiation-config';
import { SANDBOX_PAYMENT_URL } from '../../src/payments/vnpay/vnpay-config';
import { canonicalize, signParameters } from '../../src/payments/vnpay/vnpay-signing';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !/^\/brewlite_b2a_[a-f0-9]{12}_test$/.test(new URL(connectionString).pathname)
  || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname)) throw Error('Local isolated test database required');
const schema = 'd1_' + randomUUID().replaceAll('-', ''), url = new URL(connectionString);
url.searchParams.set('options', '-c search_path=' + schema);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(url.toString()) }, { schema }) });
const client = new Client({ connectionString }), secret = 'synthetic-b2a-d1-only-not-merchant';
const settings = new ConfigService({ FRONTEND_ORIGIN: 'http://localhost:3000', JWT_SECRET: 'synthetic-d1-jwt-key-at-least-32-bytes', JWT_EXPIRES_IN: 3600,
  ...initiationSettings({ NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_TEST_ONLY: 'true', DATABASE_URL: connectionString, TEST_DATABASE_URL: connectionString,
    VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
    VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' }) });
let app: NestExpressApplication, jwt: JwtService, ingress: Server, port: number;
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).overrideProvider(ConfigService).useValue(settings).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.listen(0, '127.0.0.1'); jwt = app.get(JwtService);
  const httpServer: Server = app.getHttpServer(); const address = httpServer.address() as AddressInfo;
  expect(address.address).toBe('127.0.0.1');
  ingress = createCallbackIngress({ upstreamPort: address.port }); await new Promise<void>(ok => ingress.listen(0, '127.0.0.1', ok)); port = (ingress.address() as AddressInfo).port;
});
afterAll(async () => {
  if (ingress) { ingress.closeAllConnections(); await new Promise<void>(ok => ingress.close(() => ok())); }
  if (app) await app.close(); await db.$disconnect();
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end();
});
beforeEach(() => settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'));
async function fixture(total = 5000) {
  const user = await db.user.create({ data: { email: randomUUID() + '@example.invalid', passwordHash: 'NON_LOGIN_SYNTHETIC', loyaltyPoints: 50 } });
  await db.loyaltyEntry.create({ data: { userId: user.id, kind: 'OPENING', points: 50, availableDelta: 50, reservedDelta: 0, debtDelta: 0n, effectKey: 'OPENING:' + user.id } });
  const product = await db.product.create({ data: { name: 'D1 isolated fixture', price: String(total + 5000), stock: 10, imageUrl: '/fixture', sizes: { create: { size: 'S', extraPrice: '0' } } } });
  const cart = await db.cart.create({ data: { userId: user.id } });
  await db.cartItem.create({ data: { cartId: cart.id, productId: product.id, size: 'S', qty: 1, configurationKey: product.id + ':S' } });
  const auth = 'Bearer ' + jwt.sign({ sub: user.id });
  const created = await request(app.getHttpServer()).post('/orders').set('Authorization', auth).set('Idempotency-Key', randomUUID())
    .send({ items: [{ productId: product.id, size: 'S', qty: 1, toppingIds: [] }], redeemedPoints: 50 }).expect(201);
  const orderId = (created.body as { id: string }).id;
  return { userId: user.id, productId: product.id, orderId, auth };
}
async function started() {
  const f = await fixture(); const r = await request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', f.auth).set('Idempotency-Key', randomUUID()).send({ orderId: f.orderId }).expect(201);
  const attemptId = (r.body as { attemptId: string }).attemptId;
  const a = await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  const fields = { vnp_TmnCode: 'TEST0001', vnp_TxnRef: a.txnRef, vnp_Amount: a.amount.times(100).toFixed(0), vnp_BankCode: 'NCB',
    vnp_OrderInfo: 'Thanh toan BrewLite ' + a.txnRef, vnp_TransactionNo: String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12))), vnp_ResponseCode: '00', vnp_TransactionStatus: '00' };
  const raw = canonicalize(fields) + '&vnp_SecureHash=' + signParameters(fields, secret);
  return { ...f, attemptId, raw };
}
function viaIngress(path: string) {
  return new Promise<{ status: number; body: string; location?: string; cache?: string }>((ok, fail) => {
    const r = httpRequest({ hostname: '127.0.0.1', port, path, headers: { Host: 'attacker.example', 'X-Forwarded-Host': 'attacker.example' }, agent: false }, res => {
      let body = ''; res.on('data', b => { body += String(b); }); res.on('end', () => ok({ status: res.statusCode!, body, location: res.headers.location, cache: res.headers['cache-control'] }));
    }); r.on('error', fail); r.end();
  });
}
async function fingerprints() {
  const tables = (await client.query<{ tablename: string }>('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', [schema])).rows;
  const hashes: Record<string, unknown> = {};
  for (const { tablename: t } of tables) {
    if (!/^[a-z_]+$/.test(t)) throw Error('Unexpected test table');
    hashes[t] = (await client.query(`SELECT count(*)::int count,md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) hash FROM "${schema}"."${t}" x`)).rows[0];
  }
  return { hashes, sequences: (await client.query('SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename', [schema])).rows as unknown[] };
}
test('valid signed Return through real HTTP ingress preserves303/opaque context and ALL financial fingerprints', async () => {
  const f = await started(), before = await fingerprints(); const r = await viaIngress('/payments/vnpay/return?' + f.raw);
  expect(r).toEqual({ status: 303, body: '', location: 'http://localhost:3000/payments/vnpay/result?attemptId=' + f.attemptId, cache: 'no-store' });
  expect(await fingerprints()).toEqual(before); expect((await db.order.findUniqueOrThrow({ where: { id: f.orderId } })).status).toBe('PENDING');
  expect(await db.payment.count({ where: { orderId: f.orderId } })).toBe(0); expect(await db.paymentVerification.count({ where: { attemptId: f.attemptId } })).toBe(0);
});
test('IPN alone applies exactly once; forwarding/repeated Return never creates extra Attempt/Payment/Award/effects', async () => {
  const f = await started(); const r = await viaIngress('/payments/vnpay/ipn?' + f.raw);
  expect(r.status).toBe(200); expect(JSON.parse(r.body) as unknown).toEqual({ RspCode: '00', Message: expect.any(String) as unknown });
  const settled = await fingerprints();
  expect((await viaIngress('/payments/vnpay/return?' + f.raw)).status).toBe(303);
  const repeat = await viaIngress('/payments/vnpay/ipn?' + f.raw);
  expect(JSON.parse(repeat.body) as unknown).toMatchObject({ RspCode: '02' }); expect(await fingerprints()).toEqual(settled);
  expect(await db.paymentAttempt.count({ where: { orderId: f.orderId } })).toBe(1); expect(await db.payment.count({ where: { orderId: f.orderId } })).toBe(1);
  expect(await db.loyaltyAward.count({ where: { orderId: f.orderId } })).toBe(1); expect(await db.loyaltyEntry.count({ where: { orderId: f.orderId, kind: 'SETTLE' } })).toBe(1);
  expect(await db.loyaltyEntry.count({ where: { orderId: f.orderId, kind: 'EARN' } })).toBe(1); expect((await db.product.findUniqueOrThrow({ where: { id: f.productId } })).stock).toBe(9);
  expect(await db.cartItem.count({ where: { cart: { userId: f.userId } } })).toBe(0);
});
test.each(['duplicate', 'percent', 'utf8', 'signature', 'foreign-redirect'])('backend rejects%s via ingress with no table/sequence mutation', async kind => {
  const f = await started(); let raw = f.raw;
  if (kind === 'duplicate') raw += '&vnp_Amount=1';
  if (kind === 'percent') raw += '&vnp_CardType=%GG';
  if (kind === 'utf8') raw += '&vnp_CardType=%C0%AF';
  if (kind === 'signature') raw = raw.slice(0, -1) + (raw.endsWith('a') ? 'b' : 'a');
  if (kind === 'foreign-redirect') raw += '&next=https%3A%2F%2Fevil.example';
  const before = await fingerprints();
  const direct = await request(app.getHttpServer()).get('/payments/vnpay/ipn?' + raw).expect(200);
  const proxied = await viaIngress('/payments/vnpay/ipn?' + raw);
  expect(proxied.status).toBe(200); expect(proxied.body).toBe(direct.text); expect(JSON.parse(proxied.body) as unknown).toMatchObject({ RspCode: kind === 'signature' ? '97' : '99' });
  const r = await viaIngress('/payments/vnpay/return?' + raw); expect(r.location).toBe('http://localhost:3000/payments/vnpay/result'); expect(await fingerprints()).toEqual(before);
});
test('MOCK remains OFF for gateway callbacks through ingress; no fallback or effects', async () => {
  const f = await started(); settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); const before = await fingerprints();
  const ipn = await viaIngress('/payments/vnpay/ipn?' + f.raw); expect(JSON.parse(ipn.body) as unknown).toMatchObject({ RspCode: '99' });
  expect((await viaIngress('/payments/vnpay/return?' + f.raw)).location).toBe('http://localhost:3000/payments/vnpay/result'); expect(await fingerprints()).toEqual(before);
});
test('unlisted financial APIs cannot create attempts, payments or other mutations through ingress', async () => {
  const f = await fixture(), before = await fingerprints();
  for (const path of ['/payments/config', '/payments/vnpay/attempts', '/orders/' + f.orderId + '/confirm-zero', '/admin/payments/vnpay/attempts/x/reconcile', '/auth/login', '/cart', '/products', '/orders'])
    expect((await viaIngress(path)).status).toBe(404);
  expect(await fingerprints()).toEqual(before);
});
test.each([0, 1, 4999, 5000])('minimum audit: immutable total%s creation kept; zero cannot complete a positive Order', async amount => {
  // Subminimum Orders model preserved pre-policy/MOCK history, not new VNPAY creation.
  if (amount > 0 && amount < 5000) settings.set('PAYMENT_PROVIDER_MODE', 'MOCK');
  const f = await fixture(amount); settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'); const before = await fingerprints();
  const r = await request(app.getHttpServer()).post('/orders/' + f.orderId + '/confirm-zero').set('Authorization', f.auth).set('Idempotency-Key', randomUUID()).send({});
  if (amount === 0) { expect(r.status).toBe(200); expect(r.body as unknown).toMatchObject({ payment: { provider: 'INTERNAL_ZERO', method: 'ZERO_TOTAL', amount: '0' }, loyalty: { awardedPoints: 0 } }); }
  else { expect(r.status).toBe(422); expect(await fingerprints()).toEqual(before); }
  if (amount > 0) {
    const init = await request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', f.auth).set('Idempotency-Key', randomUUID()).send({ orderId: f.orderId }).expect(amount < 5000 ? 422 : 201);
    if (amount < 5000) { expect(init.body as unknown).toMatchObject({ error: { code: 'VNPAY_MINIMUM_AMOUNT_NOT_MET' } }); expect(await fingerprints()).toEqual(before); }
    else expect((init.body as { amount: string }).amount).toBe(String(amount));
  }
  expect(await db.paymentAttempt.count({ where: { orderId: f.orderId } })).toBe(amount >= 5000 ? 1 : 0);
});

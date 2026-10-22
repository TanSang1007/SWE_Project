import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { hash } from 'bcrypt';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { configureApp } from '../../src/common/configure-app';
import { utcConnectionString } from '../../src/database/pg-connection';
import { OrderService } from '../../src/orders/order.service';
import { CartService } from '../../src/cart/cart.service';
import { AttemptService } from '../../src/payments/attempt.service';
import { PaymentExpirationWorker } from '../../src/orders/payment-expiration.worker';
import { IpnService } from '../../src/payments/ipn.service';
import { PaymentReceiptWorker } from '../../src/payments/payment-receipt.worker';
import { initiationSettings } from '../../src/payments/vnpay/initiation-config';
import { SANDBOX_PAYMENT_URL } from '../../src/payments/vnpay/vnpay-config';
import { canonicalize, signParameters } from '../../src/payments/vnpay/vnpay-signing';
import { openingFixture } from './loyalty-fixture';

const source = process.env.TEST_DATABASE_URL;
if (!source || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(source).hostname)
  || !/^\/brewlite_b2a_[a-f0-9]{12}_test$/.test(new URL(source).pathname)) throw Error('Isolated local database required');
const schema = 'checkout_' + randomUUID().replaceAll('-', '');
const scoped = new URL(source); scoped.searchParams.set('options', '-c search_path=' + schema);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(scoped.toString()) }, { schema }) });
const sql = new Client({ connectionString: source });
const secret = 'synthetic-b2a-fixture-only-not-a-merchant-secret';
const config = new ConfigService({ NODE_ENV: 'test', FRONTEND_ORIGIN: 'http://localhost:3000', JWT_SECRET: 'synthetic-checkout-jwt-secret-at-least-32-bytes', JWT_EXPIRES_IN: 3600,
  ...initiationSettings({ NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_TEST_ONLY: 'true', DATABASE_URL: source, TEST_DATABASE_URL: source,
    VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
    VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' }) });
let app: NestExpressApplication, orders: OrderService, cart: CartService, attempts: AttemptService, ipn: IpnService, passwordHash: string;
beforeAll(async () => {
  await sql.connect(); await sql.query(`CREATE SCHEMA "${schema}"`); await sql.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n)).sort()) await sql.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db)
    .overrideProvider(ConfigService).useValue(config).overrideProvider(PaymentExpirationWorker).useValue({}).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init();
  orders = app.get(OrderService); cart = app.get(CartService); attempts = app.get(AttemptService); ipn = app.get(IpnService);
  passwordHash = await hash('isolated-password-2026', 10);
});
afterAll(async () => { if (app) await app.close(); await db.$disconnect(); await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await sql.end(); });
afterEach(() => jest.restoreAllMocks());
async function fixture(points = 0) {
  const user = await db.user.create({ data: { email: randomUUID() + '@example.invalid', passwordHash } });
  await openingFixture(db, user.id, 100);
  const product = await db.product.create({ data: { name: 'Isolated Latte', price: 50000, imageUrl: '/fixture', stock: 20, sizes: { create: { size: 'M', extraPrice: 0 } } } });
  const selection = { productId: product.id, size: 'M', qty: 1, toppingIds: [] };
  await cart.add(user.id, selection);
  const result = await orders.create(user.id, randomUUID(), { items: [selection], redeemedPoints: points });
  const body = result.body as { id: string; paymentStartedAt: string; expiresAt: string };
  return { user: user.id, email: user.email, product: product.id, order: body.id, body, selection };
}
async function initiate(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await attempts.initiate(f.user, randomUUID(), f.order, '127.0.0.1');
  return result.body as { attemptId: string; expiresAt: string; paymentUrl: string };
}
async function notify(f: Awaited<ReturnType<typeof fixture>>, success = true) {
  const a = await db.paymentAttempt.findFirstOrThrow({ where: { orderId: f.order } });
  const p = { vnp_TmnCode: 'TEST0001', vnp_TxnRef: a.txnRef, vnp_Amount: a.amount.times(100).toFixed(0), vnp_BankCode: 'NCB',
    vnp_OrderInfo: 'Thanh toan BrewLite ' + a.txnRef, vnp_ResponseCode: success ? '00' : '24', vnp_TransactionStatus: success ? '00' : '02',
    vnp_TransactionNo: success ? String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12))) : '0', vnp_PayDate: a.createDate };
  const raw = canonicalize(p) + '&vnp_SecureHash=' + signParameters(p, secret);
  return { raw, ack: await ipn.receive(raw) };
}
function due(f: Awaited<ReturnType<typeof fixture>>) {
  // Time is injected only at the boundary. Never rewrite an Order or signed URL.
  const expires = Date.parse(f.body.expiresAt);
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'performance'] });
  jest.setSystemTime(expires + 1);
}
afterEach(() => jest.useRealTimers());

test('ten-minute immutable deadline, backend provider expiry, resume after reload reuses one attempt', async () => {
  const f = await fixture();
  expect(Date.parse(f.body.expiresAt) - Date.parse(f.body.paymentStartedAt)).toBe(600000);
  const a = await initiate(f), original = new URL(a.paymentUrl);
  expect(a.expiresAt).toBe(f.body.expiresAt);
  expect(original.searchParams.get('vnp_ExpireDate')).toHaveLength(14);
  const resumed = await attempts.resume(f.user, f.order);
  expect(resumed.paymentUrl).toBe(a.paymentUrl);
  expect((await orders.get(f.user, f.order)).expiresAt).toBe(f.body.expiresAt);
  expect(await db.paymentAttempt.count({ where: { orderId: f.order } })).toBe(1);
  await expect(attempts.initiate(f.user, randomUUID(), f.order, '127.0.0.1')).rejects.toMatchObject({ status: 409 });
});
test('Cart CRUD is independent, B checkout blocked, A snapshot unchanged, settlement preserves B', async () => {
  const f = await fixture(), before = await db.orderItem.findMany({ where: { orderId: f.order } });
  expect((await cart.get(f.user)).items).toHaveLength(0);
  await initiate(f);
  const value = await cart.add(f.user, { ...f.selection, qty: 2 });
  await cart.update(f.user, value.items[0].id, 3);
  await expect(orders.create(f.user, randomUUID(), { items: [{ ...f.selection, qty: 3 }] })).rejects.toMatchObject({ status: 409 });
  expect(await db.order.count({ where: { userId: f.user } })).toBe(1);
  expect((await notify(f)).ack.RspCode).toBe('00');
  expect(await db.orderItem.findMany({ where: { orderId: f.order } })).toEqual(before);
  expect((await cart.get(f.user)).items[0].qty).toBe(3);
  expect((await orders.create(f.user, randomUUID(), { items: [{ ...f.selection, qty: 3 }] })).body).toMatchObject({ status: 'PENDING' });
});
test('Cart edits/removal do not gate IPN or clear newly added identical configuration', async () => {
  const f = await fixture(); await initiate(f);
  const added = await cart.add(f.user, f.selection); await cart.remove(f.user, added.items[0].id);
  await cart.add(f.user, { ...f.selection, qty: 4 });
  expect((await notify(f)).ack.RspCode).toBe('00');
  expect((await cart.get(f.user)).items[0].qty).toBe(4);
});
test('expired unresolved attempt holds stock/loyalty, rejects resume and B, late success and duplicate settle once', async () => {
  const f = await fixture(50), key = randomUUID(); await attempts.initiate(f.user, key, f.order, '127.0.0.1'); due(f);
  const worker = new PaymentExpirationWorker(db as unknown as PrismaService, orders); await worker.tick();
  const expired = await db.order.findUniqueOrThrow({ where: { id: f.order } });
  expect(expired.status).toBe('PENDING'); expect(expired.paymentExpiredAt).not.toBeNull(); expect(expired.redemptionState).toBe('RESERVED');
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(19);
  await expect(attempts.resume(f.user, f.order)).rejects.toMatchObject({ status: 409 });
  await expect(attempts.initiate(f.user, key, f.order, '127.0.0.1')).rejects.toMatchObject({ status: 409 });
  expect((await fixture()).body.id).not.toBe(f.order); // Another customer is not blocked by A's unknown outcome.
  await cart.add(f.user, f.selection);
  await expect(orders.create(f.user, randomUUID(), { items: [f.selection] })).rejects.toMatchObject({ status: 409 });
  const result = await notify(f); expect(result.ack.RspCode).toBe('00');
  expect((await ipn.receive(result.raw)).RspCode).toBe('02'); await worker.tick();
  expect((await db.order.findUniqueOrThrow({ where: { id: f.order } })).status).toBe('PAID');
  expect(await db.payment.count({ where: { orderId: f.order, status: 'SUCCEEDED' } })).toBe(1);
  expect(await db.loyaltyAward.count({ where: { orderId: f.order } })).toBe(1);
});
test('late failure then restart/multiple expiration workers cancels once and releases reservations once', async () => {
  const f = await fixture(50); await initiate(f); due(f);
  const result = await notify(f, false); expect(result.ack.RspCode).toBe('00');
  const workers = [new PaymentExpirationWorker(db as unknown as PrismaService, orders), new PaymentExpirationWorker(db as unknown as PrismaService, orders)];
  await Promise.all(workers.map(worker => worker.tick()));
  await workers[0].tick();
  const order = await db.order.findUniqueOrThrow({ where: { id: f.order } });
  expect(order).toMatchObject({ status: 'CANCELLED', cancellationReason: 'PAYMENT_TIMEOUT', redemptionState: 'RELEASED' });
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(20);
  expect(await db.loyaltyEntry.count({ where: { orderId: f.order, kind: 'RELEASE' } })).toBe(1);
  expect((await ipn.receive(result.raw)).RspCode).toBe('02');
  expect(await db.payment.count({ where: { orderId: f.order, status: 'SUCCEEDED' } })).toBe(0);
  await cart.add(f.user, f.selection); expect((await orders.create(f.user, randomUUID(), { items: [f.selection] })).body).toMatchObject({ status: 'PENDING' });
});
test('success racing expiration cannot cancel PAID or release paid inventory', async () => {
  const f = await fixture(); await initiate(f); due(f);
  await Promise.all([notify(f), orders.cancel(f.user, f.order, true)]);
  expect((await db.order.findUniqueOrThrow({ where: { id: f.order } })).status).toBe('PAID');
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(19);
});
test('restart scan cancels expired order with no issued attempt, preserving Cart B', async () => {
  const f = await fixture(50); await cart.add(f.user, f.selection); due(f);
  await new PaymentExpirationWorker(db as unknown as PrismaService, orders).tick();
  expect((await db.order.findUniqueOrThrow({ where: { id: f.order } })).status).toBe('CANCELLED');
  expect((await cart.get(f.user)).items).toHaveLength(1);
});
test('restart resumes durable verified T1 receipt before safely cancelling a timed-out failure', async () => {
  const f = await fixture(50); await initiate(f); due(f);
  jest.spyOn(ipn, 'apply').mockRejectedValueOnce(new Error('Synthetic T2 interruption'));
  expect((await notify(f, false)).ack.RspCode).toBe('99');
  expect(await db.payment.count({ where: { orderId: f.order } })).toBe(0);
  await new PaymentReceiptWorker(db as unknown as PrismaService, ipn, config).tick();
  await new PaymentExpirationWorker(db as unknown as PrismaService, orders).tick();
  expect((await db.order.findUniqueOrThrow({ where: { id: f.order } })).status).toBe('CANCELLED');
  expect(await db.loyaltyEntry.count({ where: { orderId: f.order, kind: 'RELEASE' } })).toBe(1);
});
test.each(['CUSTOMER', 'ADMIN', 'STAFF'] as const)('%s restores from HttpOnly rotated session, rechecks role and logout revokes JWT', async role => {
  const user = await db.user.create({ data: { email: randomUUID() + '@example.invalid', passwordHash, role } });
  const post = (path: string) => request(app.getHttpServer()).post('/auth/' + path).set('Origin', 'http://localhost:3000').set('X-BrewLite-CSRF', '1');
  const login = await post('login').send({ email: user.email, password: 'isolated-password-2026' }).expect(200);
  const cookie = (login.headers['set-cookie'] as unknown as string[])[0]; expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax'); expect(cookie).toContain('Path=/api/auth'); expect(cookie).toContain('Expires=');
  const restored = await post('session').set('Cookie', cookie.split(';')[0]).expect(200);
  const restoredBody = restored.body as { user: { role: string }; accessToken: string };
  expect(restoredBody.user.role).toBe(role);
  const rotated = (restored.headers['set-cookie'] as unknown as string[])[0].split(';')[0]; expect(rotated).not.toBe(cookie.split(';')[0]);
  await request(app.getHttpServer()).get('/orders/active').set('Authorization', 'Bearer ' + restoredBody.accessToken).expect(role === 'CUSTOMER' ? 200 : 403);
  await post('logout').set('Cookie', rotated).expect(200);
  await post('session').set('Cookie', rotated).expect(401);
  await request(app.getHttpServer()).get('/orders/active').set('Authorization', 'Bearer ' + restoredBody.accessToken).expect(401);
});
test('session origin/CSRF fail closed; expired/reused refresh cannot restore or access other account', async () => {
  const user = await db.user.create({ data: { email: randomUUID() + '@example.invalid', passwordHash } });
  await request(app.getHttpServer()).post('/auth/login').send({ email: user.email, password: 'isolated-password-2026' }).expect(403);
  const post = () => request(app.getHttpServer()).post('/auth/session').set('Origin', 'http://localhost:3000').set('X-BrewLite-CSRF', '1');
  const result = await request(app.getHttpServer()).post('/auth/login').set('Origin', 'http://localhost:3000').set('X-BrewLite-CSRF', '1').send({ email: user.email, password: 'isolated-password-2026' }).expect(200);
  const old = (result.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  const rotated = await post().set('Cookie', old).expect(200);
  await post().set('Cookie', old).expect(401);
  await post().set('Cookie', (rotated.headers['set-cookie'] as unknown as string[])[0].split(';')[0]).expect(401);
  await db.authSession.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
  await post().set('Cookie', old).expect(401);
  expect(app.get(JwtService).verify<{ sub: string }>((result.body as { accessToken: string }).accessToken).sub).toBe(user.id);
});

import { openingFixture } from './loyalty-fixture';
import { utcConnectionString } from '../../src/database/pg-connection';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PrismaClient, Prisma, type Product } from '../../src/generated/prisma/client';
import { PaymentService } from '../../src/payments/payment.service';
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { configureApp } from '../../src/common/configure-app';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local database required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test required');
const schema = `brewlite_b11_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const scopedUrl = new URL(connectionString); scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(scopedUrl.toString()) }, { schema }) });
let app: NestExpressApplication; let jwt: JwtService; let mode: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter((n) => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma)
    .overrideProvider(MockPaymentService).useValue({ result: () => mode }).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
});
beforeEach(() => { mode = 'SUCCESS'; });
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
async function fixture(price = '40001', discount?: string, shared?: { product: Product; topping: { id: string } }, extra = false) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only' } });
  const token = jwt.sign({ sub: user.id });
  const product = shared?.product ?? await prisma.product.create({ data: { name: 'Drink', price, stock: 10, imageUrl: '/images/test.jpg', sizes: { create: { size: 'M', extraPrice: '0' } } } });
  const topping = shared?.topping ?? await prisma.topping.create({ data: { name: 'Cream', price: '9999' } });
  if (!shared) await prisma.productTopping.create({ data: { productId: product.id, toppingId: topping.id } });
  const item = { productId: product.id, size: 'M', qty: 2, toppingIds: [topping.id] };
  const cart = await prisma.cart.create({ data: { userId: user.id, items: { create: { productId: product.id, size: 'M', qty: 2,
    configurationKey: [product.id, 'M', topping.id].join(':'), toppings: { create: { toppingId: topping.id } } } } } });
  const items = [item];
  if (extra) {
    await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, size: 'M', qty: 1, configurationKey: `${product.id}:M` } });
    items.push({ productId: product.id, size: 'M', qty: 1, toppingIds: [] });
  }
  let promotionCode: string | undefined;
  if (discount) { const p = await prisma.promotion.create({ data: { code: randomUUID().replaceAll('-', '').toUpperCase(), discountAmount: discount,
    minimumSubtotal: '0', startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01'), isActive: true } }); promotionCode = p.code; }
  const key = randomUUID();
  const created = await request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', key)
    .send({ items, ...(promotionCode ? { promotionCode } : {}) }).expect(201);
  return { user, token, product, topping, cart, order: created.body as { id: string; total: string }, createKey: key, item };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Body = { payment: { id: string; status: string; amount: string }; order: { status: string }; loyalty: { awardedPoints: number } };
type ErrorBody = { error: { code: string } };
const pay = (f: Fixture, key: string = randomUUID(), body: object = { orderId: f.order.id, method: 'WALLET' }) => request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${f.token}`).set('Idempotency-Key', key).send(body);
const cancel = (f: Fixture) => request(app.getHttpServer()).post(`/orders/${f.order.id}/cancel`).set('Authorization', `Bearer ${f.token}`);
const get = (f: Fixture) => request(app.getHttpServer()).get(`/orders/${f.order.id}`).set('Authorization', `Bearer ${f.token}`);
async function state(f: Fixture) {
  return { product: await prisma.product.findUniqueOrThrow({ where: { id: f.product.id } }),
    cart: await prisma.cart.findUnique({ where: { id: f.cart.id }, include: { items: { include: { toppings: true } } } }),
    order: await prisma.order.findUniqueOrThrow({ where: { id: f.order.id }, include: { items: { include: { toppings: true } } } }),
    claims: await prisma.idempotencyRequest.findMany({ where: { userId: f.user.id }, orderBy: { id: 'asc' } }),
    payments: await prisma.payment.findMany({ where: { userId: f.user.id }, orderBy: { createdAt: 'asc' } }),
    awards: await prisma.loyaltyAward.findMany({ where: { userId: f.user.id } }), user: await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }) };
}
test('PENDING success atomically persists exact Payment/PAID/paidAt/award/balance and clears purchased Cart; no second stock decrement', async () => {
  const f = await fixture(); const before = await state(f); const r = await pay(f).expect(200);
  expect(r.body).toMatchObject({ payment: { orderId: f.order.id, status: 'SUCCEEDED', amount: '100000', method: 'WALLET' }, order: { status: 'PAID' }, loyalty: { awardedPoints: 10 } });
  const s = await state(f); expect(s.product).toEqual(before.product); expect(s.order.status).toBe('PAID'); expect(s.order.paidAt).not.toBeNull();
  expect(s.order.items).toEqual(before.order.items); expect(s.cart?.items).toHaveLength(0); expect(s.awards).toHaveLength(1); expect(s.awards[0]).toMatchObject({ points: 10, orderId: f.order.id, userId: f.user.id, reversedAt: null });
  expect(s.user.loyaltyPoints).toBe(10); expect(s.payments[0]).toMatchObject({ userId: f.user.id, failureCode: null }); expect(s.payments[0].amount.toFixed(0)).toBe('100000');
  expect((await get(f).expect(200)).body).toMatchObject({ earnedPoints: 10, paymentStatus: 'SUCCEEDED', status: 'PAID' });
  await request(app.getHttpServer()).get('/cart').set('Authorization', `Bearer ${f.token}`).expect(200).expect(({ body }: { body: { items: unknown[] } }) => expect(body.items).toHaveLength(0));
  await request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${f.token}`).send(f.item).expect(201);
});
test('failure records FAILED/MOCK_DECLINED, restores once with version+1, preserves Cart and lock; no Loyalty', async () => {
  const f = await fixture(); const before = await state(f); mode = 'FAILURE'; const key = randomUUID(); const result = await pay(f, key).expect(200);
  expect(result.body).toMatchObject({ payment: { status: 'FAILED', failureCode: 'MOCK_DECLINED' }, order: { status: 'PAYMENT_FAILED' }, loyalty: { awardedPoints: 0 } });
  const s = await state(f); expect(s.product).toMatchObject({ stock: 10, version: 2 }); expect(s.cart).toEqual(before.cart); expect(s.user).toEqual(before.user); expect(s.awards).toHaveLength(0); expect(s.order.paidAt).toBeNull();
  const row = s.cart!.items[0]; for (const method of ['post', 'patch', 'delete'] as const) {
    await request(app.getHttpServer())[method](method === 'post' ? '/cart/items' : `/cart/items/${row.id}`).set('Authorization', `Bearer ${f.token}`).send(method === 'post' ? f.item : method === 'patch' ? { qty: 1 } : {}).expect(409);
  }
  mode = 'SUCCESS'; const replay = await pay(f, key).expect(200); expect(replay.body).toEqual(result.body); expect(replay.headers['idempotency-replayed']).toBe('true'); expect(await state(f)).toEqual(s);
});
test('failed retry success uses snapshot price/options/discount and awards once; reacquires stock exactly', async () => {
  const f = await fixture('40001', '19999'); mode = 'FAILURE'; const oldKey = randomUUID(); const failed = await pay(f, oldKey).expect(200);
  await prisma.product.update({ where: { id: f.product.id }, data: { price: '1', name: 'Changed' } });
  await prisma.topping.update({ where: { id: f.topping.id }, data: { price: '1' } });
  await prisma.productTopping.deleteMany({ where: { productId: f.product.id } });
  await prisma.promotion.updateMany({ where: { id: (await state(f)).order.promotionId! }, data: { isActive: false } });
  mode = 'SUCCESS'; const key = randomUUID(); const r = await pay(f, key, { orderId: f.order.id, method: 'CARD' }).expect(200);
  expect(r.body).toMatchObject({ payment: { amount: '80001', status: 'SUCCEEDED', method: 'CARD' }, loyalty: { awardedPoints: 8 } });
  const s = await state(f); expect(s.product).toMatchObject({ stock: 8, version: 3 }); expect(s.payments).toHaveLength(2); expect(s.awards).toHaveLength(1); expect(s.user.loyaltyPoints).toBe(8); expect(s.cart?.items).toHaveLength(0);
  expect((await pay(f, oldKey).expect(200)).body).toEqual(failed.body); expect(await state(f)).toEqual(s);
  const replay = await pay(f, key, { orderId: f.order.id, method: 'CARD' }).expect(200); expect(replay.body).toEqual(r.body); expect(await state(f)).toEqual(s);
});
test('retry failure reacquires/restores once and stays locked; failed cancellation never double-restocks or awards', async () => {
  const f = await fixture(); mode = 'FAILURE'; await pay(f).expect(200); await pay(f).expect(200);
  const before = await state(f); expect(before.product).toMatchObject({ stock: 10, version: 4 }); expect(before.payments).toHaveLength(2); expect(before.awards).toHaveLength(0);
  await cancel(f).expect(200); await cancel(f).expect(200); const s = await state(f); expect(s.product).toEqual(before.product); expect(s.cart).toEqual(before.cart); expect(s.awards).toHaveLength(0); expect(s.user.loyaltyPoints).toBe(0);
  await request(app.getHttpServer()).patch(`/cart/items/${s.cart!.items[0].id}`).set('Authorization', `Bearer ${f.token}`).send({ qty: 1 }).expect(200);
});
test('retry insufficient stock rolls back cleanly with same-key retry possible after replenishment', async () => {
  const f = await fixture(); mode = 'FAILURE'; await pay(f).expect(200); mode = 'SUCCESS'; await prisma.product.update({ where: { id: f.product.id }, data: { stock: 1 } });
  const before = await state(f); const key = randomUUID(); const r = await pay(f, key).expect(409); expect((r.body as ErrorBody).error.code).toBe('OUT_OF_STOCK'); expect(await state(f)).toEqual(before);
  await prisma.product.update({ where: { id: f.product.id }, data: { stock: 2, version: { increment: 1 } } }); await pay(f, key).expect(200); expect((await state(f)).product.stock).toBe(0);
});
test('same key success replays exact result without payment/stock/Cart/award/balance mutation; different method rejected', async () => {
  const f = await fixture(); const key = randomUUID(); const first = await pay(f, key).expect(200); const before = await state(f);
  const replay = await pay(f, key).expect(200); expect(replay.body).toEqual(first.body); expect(replay.headers['idempotency-replayed']).toBe('true');
  expect((await pay(f, key, { orderId: f.order.id, method: 'CARD' }).expect(409)).body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } }); expect(await state(f)).toEqual(before);
});
test('same key different owned order rejected and missing/cross-user order404 even for committed key', async () => {
  const f = await fixture(); const key = randomUUID(); await pay(f, key).expect(200);
  const other = await fixture(); await pay(other, key, { orderId: f.order.id, method: 'WALLET' }).expect(404);
  await pay(f, key, { orderId: randomUUID(), method: 'WALLET' }).expect(404);
  const created = await request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${f.token}`).set('Idempotency-Key', randomUUID()).send({ items: [f.item] }).expect(400);
  expect(created.status).toBe(400); // Paid Cart is empty until a new item is added.
  await request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${f.token}`).send(f.item).expect(201);
  const next = await request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${f.token}`).set('Idempotency-Key', randomUUID()).send({ items: [f.item] }).expect(201);
  await pay(f, key, { orderId: (next.body as { id: string }).id, method: 'WALLET' }).expect(409).expect(({ body }: { body: ErrorBody }) => expect(body.error.code).toBe('IDEMPOTENCY_KEY_REUSED'));
});
test.each(['PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'] as const)('new key rejects invalid payment state %s without mutation', async (status) => {
  const f = await fixture(); if (status === 'CANCELLED') await cancel(f).expect(200); else { await pay(f).expect(200); if (status !== 'PAID') await prisma.order.update({ where: { id: f.order.id }, data: { status } }); }
  const before = await state(f); const r = await pay(f).expect(409); expect((r.body as ErrorBody).error.code).toBe(status === 'CANCELLED' ? 'INVALID_ORDER_STATE' : 'ORDER_ALREADY_PAID'); expect(await state(f)).toEqual(before);
});
test('replay after COMPLETED does not award again and returns historical PAID; GET returns current state', async () => {
  const f = await fixture(); const key = randomUUID(); const first = await pay(f, key).expect(200); await prisma.order.update({ where: { id: f.order.id }, data: { status: 'COMPLETED' } });
  const before = await state(f); expect((await pay(f, key).expect(200)).body).toEqual(first.body); expect(await state(f)).toEqual(before); expect((await get(f).expect(200)).body).toMatchObject({ status: 'COMPLETED', earnedPoints: 10 });
});
test('syntax/auth validation rejects client owner/amount/outcome/card/query and missing/invalid key', async () => {
  const f = await fixture(); const before = await state(f);
  await request(app.getHttpServer()).post('/payments').send({ orderId: f.order.id, method: 'WALLET' }).expect(401);
  await request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${f.token}`).send({ orderId: f.order.id, method: 'WALLET' }).expect(400);
  await pay(f, 'bad key').expect(400); await pay(f, 'a'.repeat(129)).expect(400);
  for (const field of ['userId', 'amount', 'status', 'success', 'cardNumber']) await pay(f, randomUUID(), { orderId: f.order.id, method: 'CARD', [field]: '1' }).expect(400);
  for (const method of ['CASH', 'wallet', null, 1]) await pay(f, randomUUID(), { orderId: f.order.id, method }).expect(400);
  await pay(f, randomUUID(), { orderId: 'bad', method: 'WALLET' }).expect(400); await pay(f).query({ userId: f.user.id }).expect(400); expect(await state(f)).toEqual(before);
});
test.each(['9999', '10000', '19999', '20000', '100000'])('discount exact final amount %s produces floor points', async (total) => {
  const f = await fixture('40001', total === '100000' ? undefined : String(100000 - Number(total)));
  const r = await pay(f).expect(200); expect((r.body as Body).payment.amount).toBe(total); expect((r.body as Body).loyalty.awardedPoints).toBe(Math.floor(Number(total) / 10000));
  expect((await state(f)).user.loyaltyPoints).toBe(Math.floor(Number(total) / 10000));
});
test('zero total success writes zero award; zero total failure writes no award', async () => {
  const f = await fixture('40001', '200000'); const r = await pay(f).expect(200); expect((r.body as Body).payment.amount).toBe('0'); expect((await state(f)).awards[0].points).toBe(0);
  const other = await fixture('40001', '200000'); mode = 'FAILURE'; await pay(other).expect(200); expect((await state(other)).awards).toHaveLength(0);
});
test('maximum-range Decimal amount and integer points remain exact', async () => {
  const f = await fixture('499999990000'); expect(f.order.total).toBe('999999999998'); const r = await pay(f).expect(200);
  expect(r.body).toMatchObject({ payment: { amount: '999999999998' }, loyalty: { awardedPoints: 99999999 } });
  expect((await state(f)).user.loyaltyPoints).toBe(99999999);
});
test('existing balance increment exact across distinct orders; balance overflow rolls back', async () => {
  const f = await fixture(); await openingFixture(prisma, f.user.id, 37); await pay(f).expect(200); expect((await state(f)).user.loyaltyPoints).toBe(47);
  const other = await fixture(); await openingFixture(prisma, other.user.id, 2147483640); const before = await state(other); await pay(other).expect(503); expect(await state(other)).toEqual(before);
});
test.each(['payments', 'loyalty_awards', 'users', 'cart_items', 'idempotency_requests', 'products', 'orders'])('real PostgreSQL fault at %s rolls back whole payment transaction', async (table) => {
  const f = await fixture(); if (table === 'products') mode = 'FAILURE'; const before = await state(f);
  const event = table === 'cart_items' ? 'DELETE' : ['payments', 'loyalty_awards'].includes(table) ? 'INSERT' : 'UPDATE';
  await client.query(`CREATE FUNCTION fail_b11() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected fault'; END $$`);
  await client.query(`CREATE TRIGGER fail_b11 BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_b11()`);
  const key = randomUUID();
  try { const r = await pay(f, key).expect(503); expect((r.body as ErrorBody).error.code).toBe('PAYMENT_UNAVAILABLE'); expect(r.text).not.toMatch(/injected fault|Prisma|password|stack/); expect(await state(f)).toEqual(before); }
  finally { await client.query(`DROP TRIGGER fail_b11 ON ${table}`); await client.query('DROP FUNCTION fail_b11()'); }
  mode = 'SUCCESS'; await pay(f, key).expect(200);
});
test('retry fault after reacquiring stock rolls back reacquisition and leaves PAYMENT_FAILED', async () => {
  const f = await fixture(); mode = 'FAILURE'; await pay(f).expect(200); mode = 'SUCCESS'; const before = await state(f);
  await client.query(`CREATE FUNCTION fail_b11_retry() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected fault'; END $$`);
  await client.query('CREATE TRIGGER fail_b11_retry BEFORE INSERT ON loyalty_awards FOR EACH ROW EXECUTE FUNCTION fail_b11_retry()');
  try { await pay(f).expect(503); expect(await state(f)).toEqual(before); }
  finally { await client.query('DROP TRIGGER fail_b11_retry ON loyalty_awards'); await client.query('DROP FUNCTION fail_b11_retry()'); }
});
test('Cart clear uses snapshot configuration and quantity, preserves extra qty/config and other user Cart', async () => {
  const f = await fixture(); const other = await fixture(); const otherBefore = await state(other);
  await prisma.cartItem.updateMany({ where: { cartId: f.cart.id }, data: { qty: 3 } });
  await prisma.cartItem.create({ data: { cartId: f.cart.id, productId: f.product.id, size: 'M', qty: 1, configurationKey: `${f.product.id}:M` } });
  await pay(f).expect(200); const s = await state(f); expect(s.cart?.items).toHaveLength(2); expect(s.cart?.items.every((i) => i.qty === 1)).toBe(true); expect(await state(other)).toEqual(otherBefore);
});
test('missing purchased configuration causes atomic rollback instead of clearing unrelated Cart', async () => {
  const f = await fixture(); await prisma.cartItem.deleteMany({ where: { cartId: f.cart.id } }); const before = await state(f); await pay(f).expect(503); expect(await state(f)).toEqual(before);
});
test.each([false, true])('concurrent same-key payment (retry=%p) commits one attempt/award and exact replay', async (retry) => {
  const f = await fixture(); if (retry) { mode = 'FAILURE'; await pay(f).expect(200); mode = 'SUCCESS'; }
  const key = randomUUID(); const rs = await Promise.all([pay(f, key), pay(f, key)]); expect(rs.some((r) => r.status === 200)).toBe(true);
  expect(rs.every((r) => r.status === 200 || (r.status === 409 && (r.body as ErrorBody).error.code === 'IDEMPOTENCY_IN_PROGRESS'))).toBe(true);
  const replay = await pay(f, key).expect(200); for (const r of rs.filter((r) => r.status === 200)) expect(r.body).toEqual(replay.body);
  const s = await state(f); expect(s.payments.filter((p) => p.status === 'SUCCEEDED')).toHaveLength(1); expect(s.awards).toHaveLength(1); expect(s.user.loyaltyPoints).toBe(10); expect(s.product.stock).toBe(8);
});
test.each([false, true])('concurrent different-key payment (retry=%p) only one success and award', async (retry) => {
  const f = await fixture(); if (retry) { mode = 'FAILURE'; await pay(f).expect(200); mode = 'SUCCESS'; }
  const rs = await Promise.all([pay(f), pay(f)]); expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  const s = await state(f); expect(s.payments.filter((p) => p.status === 'SUCCEEDED')).toHaveLength(1); expect(s.awards).toHaveLength(1); expect(s.user.loyaltyPoints).toBe(10); expect(s.product.stock).toBe(8);
});
test.each([false, true])('payment/cancel race (retry=%p) commits only a valid winner, never double restore/award', async (retry) => {
  const f = await fixture(); if (retry) { mode = 'FAILURE'; await pay(f).expect(200); mode = 'SUCCESS'; }
  const rs = await Promise.all([pay(f), cancel(f)]); expect(rs.map((r) => r.status).sort()).toEqual([200, 409]); const s = await state(f);
  if (s.order.status === 'PAID') { expect(s.product.stock).toBe(8); expect(s.awards).toHaveLength(1); expect(s.user.loyaltyPoints).toBe(10); expect(s.cart?.items).toHaveLength(0); }
  else { expect(s.order.status).toBe('CANCELLED'); expect(s.product.stock).toBe(10); expect(s.awards).toHaveLength(0); expect(s.user.loyaltyPoints).toBe(0); expect(s.cart?.items).toHaveLength(1); }
});
test('concurrent failure requests each attempt restores only its own stock; net stock unchanged', async () => {
  const f = await fixture(); mode = 'FAILURE'; const rs = await Promise.all([pay(f), pay(f)]); expect(rs.every((r) => r.status === 200)).toBe(true); const s = await state(f);
  expect(s.product).toMatchObject({ stock: 10, version: 4 }); expect(s.payments).toHaveLength(2); expect(s.awards).toHaveLength(0); expect(s.user.loyaltyPoints).toBe(0);
});
test('same key separates CREATE_ORDER/PAY_ORDER namespace and user scope', async () => {
  const f = await fixture(); await pay(f, f.createKey).expect(200); const other = await fixture(); await pay(other, f.createKey).expect(200);
  expect((await state(f)).claims).toHaveLength(2); expect((await state(other)).user.loyaltyPoints).toBe(10);
});
test('database unique/order constraints reject duplicate success and duplicate award', async () => {
  const f = await fixture(); await pay(f).expect(200); const s = await state(f);
  await expect(prisma.loyaltyAward.create({ data: { orderId: f.order.id, userId: f.user.id, points: 10 } })).rejects.toMatchObject({ code: 'P2002' });
  const claim = await prisma.idempotencyRequest.create({ data: { userId: f.user.id, operation: 'PAY_ORDER', idempotencyKey: randomUUID(), requestHash: 'fixture', state: 'PROCESSING' } });
  try { await expect(prisma.payment.create({ data: { orderId: f.order.id, userId: f.user.id, idempotencyRequestId: claim.id, idempotencyKey: claim.idempotencyKey, amount: '100000', method: 'CARD', status: 'SUCCEEDED' } })).rejects.toMatchObject({ code: 'P2002' }); }
  finally { await prisma.idempotencyRequest.delete({ where: { id: claim.id } }); }
  expect(await state(f)).toEqual(s);
});
test('retry of multiple snapshot configurations aggregates product stock and clears every purchased configuration', async () => {
  const f = await fixture('40001', undefined, undefined, true); mode = 'FAILURE'; await pay(f).expect(200);
  expect((await state(f)).product).toMatchObject({ stock: 10, version: 2 }); mode = 'SUCCESS'; await pay(f).expect(200);
  const s = await state(f); expect(s.product).toMatchObject({ stock: 7, version: 3 }); expect(s.cart?.items).toHaveLength(0); expect(s.user.loyaltyPoints).toBe(14);
});
test('two failed orders/users read identical last stock/version: OCC admits one retry, loser rollback preserves failed Order/Cart/no award', async () => {
  const a = await fixture(); mode = 'FAILURE'; await pay(a).expect(200); const b = await fixture('40001', undefined, a); await pay(b).expect(200);
  await prisma.product.update({ where: { id: a.product.id }, data: { stock: 2, version: { increment: 1 } } }); mode = 'SUCCESS';
  type Reader = { readStock(tx: Prisma.TransactionClient, id: string): Promise<Product> };
  const service = app.get<Reader>(PaymentService); const original = service.readStock.bind(service);
  let arrived = 0; let release!: () => void; const gate = new Promise<void>((done) => { release = done; });
  const spy = jest.spyOn(service, 'readStock').mockImplementation(async (...args) => { const row = await original(...args); if (++arrived === 2) release(); await gate; return row; });
  try {
    const rs = await Promise.all([pay(a), pay(b)]); expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((rs.find((r) => r.status === 409)?.body as ErrorBody).error.code).toBe('CONCURRENT_UPDATE');
    const states = await Promise.all([state(a), state(b)]); expect(states[0].product.stock).toBe(0);
    expect(states.reduce((sum, s) => sum + s.payments.filter((p) => p.status === 'SUCCEEDED').length, 0)).toBe(1);
    const loser = states.find((s) => s.order.status === 'PAYMENT_FAILED')!; expect(loser.cart?.items).toHaveLength(1); expect(loser.payments).toHaveLength(1); expect(loser.awards).toHaveLength(0); expect(loser.user.loyaltyPoints).toBe(0);
  } finally { release(); spy.mockRestore(); }
});

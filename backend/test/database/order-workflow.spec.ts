import { legacyAwardFixture } from './loyalty-fixture';
import { utcConnectionString } from '../../src/database/pg-connection';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpException } from '@nestjs/common';
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
import { PrismaClient, type OrderStatus } from '../../src/generated/prisma/client';
import { OrderService } from '../../src/orders/order.service';
import { PaymentService } from '../../src/payments/payment.service';
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { configureApp } from '../../src/common/configure-app';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local database required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test required');
const schema = `brewlite_b16_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const scopedUrl = new URL(connectionString); scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(scopedUrl.toString()) }, { schema }) });
let app: NestExpressApplication; let jwt: JwtService; let orders: OrderService; let payments: PaymentService;
let mode: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter((n) => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma)
    .overrideProvider(MockPaymentService).useValue({ result: () => mode }).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init();
  jwt = app.get(JwtService); orders = app.get(OrderService); payments = app.get(PaymentService);
});
beforeEach(() => { mode = 'SUCCESS'; });
afterAll(async () => {
  if (app) await app.close(); await prisma.$disconnect();
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end();
});
async function owner() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only' } });
  return { id: user.id, token: jwt.sign({ sub: user.id }) };
}
type Owner = Awaited<ReturnType<typeof owner>>;
async function fixture(who?: Owner, price = '30000', paid = true) {
  const user = who ?? await owner();
  const products = await Promise.all([1, 2].map((n) => prisma.product.create({ data: { name: `Snapshot drink ${n}`, price,
    stock: 100, imageUrl: '/images/test.jpg', sizes: { create: [{ size: 'M', extraPrice: '0' }, { size: 'L', extraPrice: '0' }] } } })));
  const topping = await prisma.topping.create({ data: { name: 'Snapshot topping', price: '0' } });
  await prisma.productTopping.create({ data: { productId: products[0].id, toppingId: topping.id } });
  const items = [{ productId: products[0].id, size: 'M', qty: 2, toppingIds: [topping.id] },
    { productId: products[0].id, size: 'L', qty: 1, toppingIds: [] }, { productId: products[1].id, size: 'M', qty: 1, toppingIds: [] }];
  const cart = await prisma.cart.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  for (const item of items) await prisma.cartItem.create({ data: { cartId: cart.id, productId: item.productId, size: item.size, qty: item.qty,
    configurationKey: [item.productId, item.size, ...item.toppingIds].join(':'), toppings: { create: item.toppingIds.map((toppingId) => ({ toppingId })) } } });
  const created = await orders.create(user.id, randomUUID(), { items }); const id = (created.body as { id: string }).id;
  const key = randomUUID(); const payment = paid ? await payments.pay(user.id, key, { orderId: id, method: 'WALLET' }) : null;
  return { user, id, products: products.map((p) => p.id).sort(), toppingId: topping.id, key, payment };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const row = (f: Fixture) => prisma.order.findUniqueOrThrow({ where: { id: f.id } });
const transition = async (f: Fixture, status: OrderStatus, version?: number) => orders.transitionOrder(f.id, version ?? (await row(f)).version, status);
async function state(f: Fixture) {
  return { order: await prisma.order.findUniqueOrThrow({ where: { id: f.id }, include: { items: { orderBy: { id: 'asc' }, include: { toppings: { orderBy: { toppingId: 'asc' } } } } } }),
    products: await prisma.product.findMany({ where: { id: { in: f.products } }, orderBy: { id: 'asc' } }),
    payments: await prisma.payment.findMany({ where: { userId: f.user.id }, orderBy: { id: 'asc' } }),
    awards: await prisma.loyaltyAward.findMany({ where: { userId: f.user.id }, orderBy: { id: 'asc' } }),
    user: await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }),
    cart: await prisma.cart.findUnique({ where: { userId: f.user.id }, include: { items: { orderBy: { id: 'asc' } } } }),
    claims: await prisma.idempotencyRequest.findMany({ where: { userId: f.user.id }, orderBy: { id: 'asc' } }) };
}
async function reject(work: Promise<unknown>, status: number, code: string) {
  try { await work; throw new Error('Expected rejection'); }
  catch (error) { expect(error).toBeInstanceOf(HttpException); expect((error as HttpException).getStatus()).toBe(status);
    expect((error as HttpException).getResponse()).toMatchObject({ code }); }
}
const auth = (f: Fixture, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${f.user.token}`);
async function balanceInvariant(userId: string) {
  const result = await client.query<{ balance: number; effective: number }>(`SELECT u.loyalty_points AS balance,
    COALESCE(SUM(a.points) FILTER (WHERE a.reversed_at IS NULL),0)::int AS effective
    FROM users u LEFT JOIN loyalty_awards a ON a.user_id=u.id WHERE u.id=$1 GROUP BY u.id`, [userId]);
  expect(result.rows[0].balance).toBe(result.rows[0].effective);
}

test('A/B/C: actual PAID -> PREPARING -> READY -> COMPLETED updates only Order status/version/timestamp', async () => {
  const f = await fixture(); const before = await state(f);
  for (const status of ['PREPARING', 'READY', 'COMPLETED'] as const) {
    const previous = await row(f); const detail = await transition(f, status);
    expect(detail).toMatchObject({ status, earnedPoints: 12, paymentStatus: 'SUCCEEDED', total: '120000' });
    const after = await state(f); expect(after.order.version).toBe(previous.version + 1); expect(after.order.updatedAt.getTime()).toBeGreaterThanOrEqual(previous.updatedAt.getTime());
    expect({ ...after, order: { ...after.order, status: before.order.status, version: before.order.version, updatedAt: before.order.updatedAt } }).toEqual(before);
    expect((await auth(f, '/orders/' + f.id).expect(200)).body).toMatchObject({ status, earnedPoints: 12 });
    expect((await auth(f, '/orders/me').expect(200)).body).toMatchObject({ items: [expect.objectContaining({ id: f.id, status, earnedPoints: 12 })] });
  }
  await balanceInvariant(f.user.id);
});
test.each(['READY', 'COMPLETED', 'PAID', 'PENDING', 'PAYMENT_FAILED'] as const)('D: PAID -> %s is rejected without mutations', async (status) => {
  const f = await fixture(); const before = await state(f); await reject(transition(f, status), 409, 'INVALID_ORDER_STATE'); expect(await state(f)).toEqual(before);
});
test.each(['PREPARING', 'READY', 'COMPLETED', 'CANCELLED'] as const)('terminal COMPLETED -> %s is rejected', async (status) => {
  const f = await fixture(); for (const s of ['PREPARING', 'READY', 'COMPLETED'] as const) await transition(f, s);
  const before = await state(f); await reject(transition(f, status), 409, 'INVALID_ORDER_STATE'); expect(await state(f)).toEqual(before);
});
test.each(['PREPARING', 'READY', 'COMPLETED', 'PAID'] as const)('terminal CANCELLED -> %s is rejected', async (status) => {
  const f = await fixture(); await transition(f, 'CANCELLED'); const before = await state(f);
  await reject(transition(f, status), 409, 'INVALID_ORDER_STATE'); expect(await state(f)).toEqual(before);
});
test('PREPARING cannot cancel or skip READY; READY cannot go back or cancel', async () => {
  const f = await fixture(); await transition(f, 'PREPARING'); let before = await state(f);
  for (const status of ['CANCELLED', 'COMPLETED'] as const) await reject(transition(f, status), 409, 'INVALID_ORDER_STATE');
  expect(await state(f)).toEqual(before); await transition(f, 'READY'); before = await state(f);
  for (const status of ['PREPARING', 'CANCELLED'] as const) await reject(transition(f, status), 409, 'INVALID_ORDER_STATE'); expect(await state(f)).toEqual(before);
});
test('missing Order404 and malformed expectedVersion400', async () => {
  await reject(orders.transitionOrder(randomUUID(), 0, 'PREPARING'), 404, 'ORDER_NOT_FOUND');
  const f = await fixture(); const before = await state(f);
  for (const v of [-1, 0.5, NaN, Infinity, 2147483648]) await reject(orders.transitionOrder(f.id, v, 'PREPARING'), 400, 'VALIDATION_ERROR');
  expect(await state(f)).toEqual(before);
});
test('expectedVersion is not replaced by the latest version; a stale command cannot skip forward', async () => {
  const f = await fixture(); const v = (await row(f)).version; await transition(f, 'PREPARING', v); const before = await state(f);
  await reject(transition(f, 'READY', v), 409, 'CONCURRENT_UPDATE'); expect(await state(f)).toEqual(before);
});
test('E: two simultaneous preparation commands commit exactly one transition', async () => {
  const f = await fixture(); const v = (await row(f)).version; const before = await state(f);
  const outcomes = await Promise.allSettled([transition(f, 'PREPARING', v), transition(f, 'PREPARING', v)]);
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const failed = outcomes.find((r) => r.status === 'rejected') as PromiseRejectedResult; expect(failed.reason).toBeInstanceOf(HttpException);
  expect((failed.reason as HttpException).getStatus()).toBe(409); const after = await state(f); expect(after.order).toMatchObject({ status: 'PREPARING', version: v + 1 });
  expect(after.products).toEqual(before.products); expect(after.awards).toEqual(before.awards); expect(after.payments).toEqual(before.payments);
});
test('E: PAID cancellation versus preparation permits only one valid edge', async () => {
  const f = await fixture(); const v = (await row(f)).version; const before = await state(f);
  const outcomes = await Promise.allSettled([transition(f, 'CANCELLED', v), transition(f, 'PREPARING', v)]);
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1); const after = await state(f); expect(after.order.version).toBe(v + 1);
  const cancelled = after.order.status === 'CANCELLED'; expect(after.user.loyaltyPoints).toBe(cancelled ? 0 : 12);
  expect(after.products.map((p) => p.stock)).toEqual(cancelled ? [100, 100] : before.products.map((p) => p.stock));
  expect(after.awards[0].reversedAt !== null).toBe(cancelled); expect(after.payments).toEqual(before.payments); await balanceInvariant(f.user.id);
});
test('G: PAID cancel aggregates snapshot quantities, restores each Product once and reverses exactly12', async () => {
  const f = await fixture(); const before = await state(f); const detail = await transition(f, 'CANCELLED'); const after = await state(f);
  expect(detail).toMatchObject({ status: 'CANCELLED', earnedPoints: 0, paymentStatus: 'SUCCEEDED', total: '120000', paidAt: before.order.paidAt!.toISOString() });
  expect(after.order.version).toBe(before.order.version + 1); expect(after.order.items).toEqual(before.order.items); expect(after.order.paidAt).toEqual(before.order.paidAt);
  expect(after.products.map((p) => p.stock)).toEqual([100, 100]); expect(after.products.map((p) => p.version)).toEqual(before.products.map((p) => p.version + 1));
  expect(after.awards).toHaveLength(1); expect(after.awards[0]).toMatchObject({ points: 12, reversedAt: expect.any(Date) as unknown });
  expect(after.user.loyaltyPoints).toBe(0); expect(after.payments).toEqual(before.payments); expect(after.cart).toEqual(before.cart); expect(after.claims).toEqual(before.claims);
  await balanceInvariant(f.user.id);
});
test('reverse uses original award even when formula differs; current catalog drift cannot reprice snapshots', async () => {
  const f = await fixture(undefined, '30000', false); // Valid pre-cutover award, without rewriting a post-cutover EARN.
  await legacyAwardFixture(prisma, f.id, 7);
  await prisma.product.updateMany({ where: { id: { in: f.products } }, data: { price: '999999', name: 'Current renamed drink' } });
  await prisma.topping.update({ where: { id: f.toppingId }, data: { name: 'Current topping', price: '999' } });
  const before = await state(f); await transition(f, 'CANCELLED'); const after = await state(f);
  expect(after.user.loyaltyPoints).toBe(0); expect(after.awards[0].points).toBe(7); expect(after.order.items).toEqual(before.order.items);
  expect(after.order.total.toFixed(0)).toBe('120000'); await balanceInvariant(f.user.id);
});
test('zero award is retained and marked reversed without negative balance', async () => {
  const f = await fixture(undefined, '1'); await transition(f, 'CANCELLED'); const after = await state(f);
  expect(after.awards[0]).toMatchObject({ points: 0, reversedAt: expect.any(Date) as unknown }); expect(after.user.loyaltyPoints).toBe(0); await balanceInvariant(f.user.id);
});
test('duplicate PAID cancel with original or current version is a completely read-only no-op', async () => {
  const f = await fixture(); const v = (await row(f)).version; await transition(f, 'CANCELLED', v); const before = await state(f);
  await transition(f, 'CANCELLED', v); await transition(f, 'CANCELLED'); expect(await state(f)).toEqual(before);
});
test('concurrent duplicate cancellation returns current CANCELLED with only one restore/reverse/version increment', async () => {
  const f = await fixture(); const v = (await row(f)).version; const before = await state(f);
  const results = await Promise.all([transition(f, 'CANCELLED', v), transition(f, 'CANCELLED', v)]);
  expect(results.every((r) => r.status === 'CANCELLED')).toBe(true); const after = await state(f);
  expect(after.order.version).toBe(v + 1); expect(after.products.map((p) => p.stock)).toEqual([100, 100]);
  expect(after.products.map((p) => p.version)).toEqual(before.products.map((p) => p.version + 1)); expect(after.user.loyaltyPoints).toBe(0); await balanceInvariant(f.user.id);
});
test('two paid Orders same owner: cancel one preserves the other award and concurrent cancels do not lose balance updates', async () => {
  const f = await fixture(); const g = await fixture(f.user); await transition(f, 'CANCELLED');
  expect((await state(g)).user.loyaltyPoints).toBe(12); expect((await state(g)).awards.find((a) => a.orderId === g.id)?.reversedAt).toBeNull(); await balanceInvariant(f.user.id);
  const h = await fixture(f.user); await Promise.all([transition(g, 'CANCELLED'), transition(h, 'CANCELLED')]); await balanceInvariant(f.user.id);
  expect((await state(h)).user.loyaltyPoints).toBe(0);
});
test('same-owner cancellation concurrent with another payment atomically keeps the new award', async () => {
  const f = await fixture(); const g = await fixture(f.user, '30000', false);
  await Promise.all([transition(f, 'CANCELLED'), payments.pay(g.user.id, g.key, { orderId: g.id, method: 'CARD' })]);
  const after = await state(g); expect(after.user.loyaltyPoints).toBe(12); expect(after.order.status).toBe('PAID'); await balanceInvariant(f.user.id);
});
test('payment replay after cancellation is historical and read-only; a new key cannot charge CANCELLED', async () => {
  const f = await fixture(); await transition(f, 'CANCELLED'); const before = await state(f);
  const replay = await payments.pay(f.user.id, f.key, { orderId: f.id, method: 'WALLET' }); expect(replay.replayed).toBe(true); expect(replay.body).toEqual(f.payment!.body);
  await reject(payments.pay(f.user.id, randomUUID(), { orderId: f.id, method: 'CARD' }), 409, 'INVALID_ORDER_STATE'); expect(await state(f)).toEqual(before);
  expect((await auth(f, '/orders/' + f.id).expect(200)).body).toMatchObject({ status: 'CANCELLED', earnedPoints: 0, paymentStatus: 'SUCCEEDED' });
  expect((await auth(f, '/loyalty').expect(200)).body).toEqual({ loyaltyPoints: 0, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
});
test('internal command cannot bypass unpaid payment/cancel write paths', async () => {
  const f = await fixture(undefined, '30000', false); let before = await state(f);
  for (const target of ['PAID', 'PAYMENT_FAILED', 'PREPARING', 'CANCELLED'] as const) await reject(transition(f, target), 409, 'INVALID_ORDER_STATE'); expect(await state(f)).toEqual(before);
  mode = 'FAILURE'; await payments.pay(f.user.id, f.key, { orderId: f.id, method: 'WALLET' }); before = await state(f);
  for (const target of ['PENDING', 'PAID', 'PREPARING', 'CANCELLED'] as const) await reject(transition(f, target), 409, 'INVALID_ORDER_STATE'); expect(await state(f)).toEqual(before);
});
test.each(['missing award', 'wrong owner', 'already reversed', 'insufficient balance', 'stock overflow', 'stock version overflow', 'order version overflow'])('H: %s is invariant503 with no partial cancellation', async (fault) => {
  const f = await fixture();
  if (fault === 'missing award') await prisma.loyaltyAward.delete({ where: { orderId: f.id } });
  if (fault === 'wrong owner') await prisma.loyaltyAward.update({ where: { orderId: f.id }, data: { userId: (await owner()).id } });
  if (fault === 'already reversed') await prisma.loyaltyAward.update({ where: { orderId: f.id }, data: { reversedAt: new Date() } });
  if (fault === 'insufficient balance') await prisma.user.update({ where: { id: f.user.id }, data: { loyaltyPoints: 11 } });
  if (fault === 'stock overflow') await prisma.product.update({ where: { id: f.products[1] }, data: { stock: 2147483647 } });
  if (fault === 'stock version overflow') await prisma.product.update({ where: { id: f.products[1] }, data: { version: 2147483647 } });
  if (fault === 'order version overflow') await prisma.order.update({ where: { id: f.id }, data: { version: 2147483647 } });
  const before = await state(f); const awardBefore = await prisma.loyaltyAward.findUnique({ where: { orderId: f.id } });
  await reject(transition(f, 'CANCELLED'), 503, 'SERVICE_UNAVAILABLE'); expect(await state(f)).toEqual(before);
  expect(await prisma.loyaltyAward.findUnique({ where: { orderId: f.id } })).toEqual(awardBefore);
});
test.each(['orders', 'products', 'loyalty_awards', 'users'])('H: actual PostgreSQL fault at %s rolls back every cancellation write', async (table) => {
  const f = await fixture(); const before = await state(f);
  // AFTER ensures the write itself occurred; for products, fault on the second sorted product.
  const condition = table === 'products' ? `IF NEW.id <> '${f.products[1]}'::uuid THEN RETURN NEW; END IF;` : '';
  await client.query(`CREATE FUNCTION fail_b16() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${condition} RAISE EXCEPTION 'injected private fault'; END $$`);
  await client.query(`CREATE TRIGGER fail_b16 AFTER UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_b16()`);
  try { await reject(transition(f, 'CANCELLED'), 503, 'SERVICE_UNAVAILABLE'); expect(await state(f)).toEqual(before); }
  finally { await client.query(`DROP TRIGGER fail_b16 ON ${table}`); await client.query('DROP FUNCTION fail_b16()'); }
  await transition(f, 'CANCELLED'); await balanceInvariant(f.user.id);
});
test('H: preparation Order write failure rolls back and maps to sanitized503', async () => {
  const f = await fixture(); const before = await state(f);
  await client.query("CREATE FUNCTION fail_b16() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private SQL fault'; END $$");
  await client.query('CREATE TRIGGER fail_b16 AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fail_b16()');
  try { await reject(transition(f, 'PREPARING'), 503, 'SERVICE_UNAVAILABLE'); expect(await state(f)).toEqual(before); }
  finally { await client.query('DROP TRIGGER fail_b16 ON orders'); await client.query('DROP FUNCTION fail_b16()'); }
});
test('F: private APIs enforce JWT/ownership and no client-controlled role/status grants internal access', async () => {
  const f = await fixture(); const other = await owner(); const before = await state(f);
  await request(app.getHttpServer()).post('/orders/' + f.id + '/cancel').expect(401);
  await request(app.getHttpServer()).post('/orders/' + f.id + '/cancel').set('Authorization', 'Bearer invalid').expect(401);
  await request(app.getHttpServer()).post('/orders/' + f.id + '/cancel').set('Authorization', `Bearer ${other.token}`).expect(404);
  await request(app.getHttpServer()).post('/orders/' + f.id + '/cancel').set('Authorization', `Bearer ${f.user.token}`).expect(409);
  for (const body of [{ role: 'ADMIN' }, { status: 'CANCELLED' }, { expectedVersion: before.order.version }, { userId: other.id }]) {
    await request(app.getHttpServer()).post('/orders/' + f.id + '/cancel').set('Authorization', `Bearer ${f.user.token}`).send(body).expect(400);
  }
  const forgedRole = jwt.sign({ sub: f.user.id, role: 'ADMIN' });
  for (const token of [f.user.token, forgedRole]) {
    await request(app.getHttpServer()).patch('/orders/' + f.id + '/status').set('Authorization', `Bearer ${token}`).send({ status: 'PREPARING' }).expect(404);
    await request(app.getHttpServer()).post('/orders/' + f.id + '/transition').set('Authorization', `Bearer ${token}`).send({ status: 'COMPLETED' }).expect(404);
  }
  await request(app.getHttpServer()).get('/orders/' + f.id).set('Authorization', `Bearer ${other.token}`).expect(404);
  await request(app.getHttpServer()).get('/orders/' + f.id).set('Authorization', `Bearer ${jwt.sign({ sub: f.user.id }, { expiresIn: -1 })}`).expect(401);
  expect(await state(f)).toEqual(before);
});

test('concurrent PREPARING and READY commands with the same expectedVersion cannot skip two steps', async () => {
  const f = await fixture(); const v = (await row(f)).version;
  const results = await Promise.allSettled([transition(f, 'PREPARING', v), transition(f, 'READY', v)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await row(f)).toMatchObject({ status: 'PREPARING', version: v + 1 });
});
test('an internal command concurrent with payment cannot cancel a newly PAID version using the old unpaid version', async () => {
  const f = await fixture(undefined, '30000', false); const v = (await row(f)).version;
  const results = await Promise.allSettled([payments.pay(f.user.id, f.key, { orderId: f.id, method: 'WALLET' }), transition(f, 'CANCELLED', v)]);
  expect(results[0].status).toBe('fulfilled'); expect(results[1].status).toBe('rejected');
  expect(await row(f)).toMatchObject({ status: 'PAID', version: v + 1 }); const after = await state(f);
  expect(after.products.map((p) => p.stock).sort()).toEqual([97, 99]); expect(after.user.loyaltyPoints).toBe(12); await balanceInvariant(f.user.id);
});
test.each(['orders', 'products', 'loyalty_awards', 'users'])('zero-row guarded %s update rejects and rolls back previous effects', async (table) => {
  const f = await fixture(); const before = await state(f);
  const condition = table === 'products' ? `IF NEW.id <> '${f.products[1]}'::uuid THEN RETURN NEW; END IF;` : '';
  await client.query(`CREATE FUNCTION block_b16() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${condition} RETURN NULL; END $$`);
  await client.query(`CREATE TRIGGER block_b16 BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION block_b16()`);
  try { const conflict = table === 'orders' || table === 'products';
    await reject(transition(f, 'CANCELLED'), conflict ? 409 : 503, conflict ? 'CONCURRENT_UPDATE' : 'SERVICE_UNAVAILABLE'); expect(await state(f)).toEqual(before); }
  finally { await client.query(`DROP TRIGGER block_b16 ON ${table}`); await client.query('DROP FUNCTION block_b16()'); }
});
test.each(['users', 'products'])('database %s lock timeout returns CONCURRENT_UPDATE and preserves all business state', async (table) => {
  const f = await fixture(); const before = await state(f); const blocker = new Client({ connectionString: utcConnectionString(scopedUrl.toString()) });
  await blocker.connect(); await blocker.query('BEGIN'); await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [table === 'users' ? f.user.id : f.products[1]]);
  try { await reject(transition(f, 'CANCELLED'), 409, 'CONCURRENT_UPDATE'); expect(await state(f)).toEqual(before); }
  finally { await blocker.query('ROLLBACK'); await blocker.end(); }
});

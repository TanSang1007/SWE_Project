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
import { PrismaClient } from '../../src/generated/prisma/client';
import { PricingService } from '../../src/pricing/pricing.service';
import { configureApp } from '../../src/common/configure-app';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local database required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test required');
const schema = `brewlite_b10_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
// ORM schema qualification does not qualify raw user-lock SQL. Scope every test
// connection's search_path too, so FOR UPDATE locks the actual fixture user.
const scopedUrl = new URL(connectionString);
scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(scopedUrl.toString()) }, { schema }) });
let app: NestExpressApplication; let jwt: JwtService;
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter((n) => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
});
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
type OrderBody = { id: string; status: string; subtotal: string; total: string; discountAmount: string; items: { unitPrice: string; lineTotal: string }[] };
async function fixture(stock = 10, qty = 2) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only' } });
  const token = jwt.sign({ sub: user.id });
  const product = await prisma.product.create({ data: { name: 'Drink', price: '40000', stock, imageUrl: '/images/test.jpg',
    sizes: { create: [{ size: 'M', extraPrice: '5000' }, { size: 'L', extraPrice: '10000' }] } } });
  const topping = await prisma.topping.create({ data: { name: 'Cream', price: '7000' } });
  await prisma.productTopping.create({ data: { productId: product.id, toppingId: topping.id } });
  const item = { productId: product.id, size: 'M', qty, toppingIds: [topping.id] };
  const cart = await prisma.cart.create({ data: { userId: user.id, items: { create: { productId: product.id, size: 'M', qty,
    configurationKey: [product.id, 'M', topping.id].join(':'), toppings: { create: { toppingId: topping.id } } } } } });
  return { user, token, product, topping, cart, input: { items: [item] }, key: randomUUID() };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = (f: Fixture, key: string = f.key, body: object = f.input) => request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${f.token}`).set('Idempotency-Key', key).send(body);
type ErrorBody = { error: { code: string; details: { existingOrderId?: string } } };
const get = (f: Fixture, id: string) => request(app.getHttpServer()).get(`/orders/${id}`).set('Authorization', `Bearer ${f.token}`);
const cancel = (f: Fixture, id: string) => request(app.getHttpServer()).post(`/orders/${id}/cancel`).set('Authorization', `Bearer ${f.token}`);
async function state(f: Fixture) {
  return { product: await prisma.product.findUnique({ where: { id: f.product.id } }), cart: await prisma.cart.findUnique({ where: { id: f.cart.id }, include: { items: { include: { toppings: true } } } }),
    orders: await prisma.order.findMany({ where: { userId: f.user.id }, include: { items: true } }), claims: await prisma.idempotencyRequest.findMany({ where: { userId: f.user.id } }),
    user: await prisma.user.findUnique({ where: { id: f.user.id } }), payments: await prisma.payment.count(), awards: await prisma.loyaltyAward.count() };
}
test('valid creation snapshots current pricing, stock exact and Cart preserved; no Payment/Loyalty', async () => {
  const f = await fixture(); const before = await state(f); const r = await create(f).expect(201); const body = r.body as OrderBody;
  expect(body).toMatchObject({ status: 'PENDING', subtotal: '104000', discountAmount: '0', total: '104000', items: [{ unitPrice: '52000', lineTotal: '104000' }] });
  const after = await state(f); expect(after.cart).toEqual(before.cart); expect(after.user).toEqual(before.user);
  expect(after.product).toMatchObject({ stock: 8, version: 1 }); expect(after.payments).toBe(0); expect(after.awards).toBe(0);
  const row = await prisma.order.findUniqueOrThrow({ where: { id: body.id }, include: { items: { include: { toppings: true } } } });
  expect(row.userId).toBe(f.user.id); expect(row.paidAt).toBeNull(); expect(row.items[0].basePrice.toFixed(0)).toBe('40000');
  expect(row.items[0].sizeExtraPrice.toFixed(0)).toBe('5000'); expect(row.items[0].toppings[0].priceSnapshot.toFixed(0)).toBe('7000');
  await prisma.product.update({ where: { id: f.product.id }, data: { price: '1', name: 'Changed' } });
  expect((await get(f, body.id).expect(200)).body).toMatchObject({ total: '104000', items: [{ productName: 'Drink', unitPrice: '52000' }], earnedPoints: null, paymentStatus: null });
});
test('unauthenticated, missing/invalid key, query/price/userId/status injection and null promotion rejected', async () => {
  const f = await fixture(); const before = await state(f);
  await request(app.getHttpServer()).post('/orders').send(f.input).expect(401);
  await request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${f.token}`).send(f.input).expect(400);
  await create(f, 'bad key').expect(400);
  for (const field of ['userId', 'total', 'subtotal', 'stock', 'status']) await create(f, f.key, { ...f.input, [field]: '1' }).expect(400);
  await create(f, f.key, { ...f.input, promotionCode: null }).expect(400); await create(f).query({ userId: f.user.id }).expect(400);
  await create(f, f.key, { items: [{ ...f.input.items[0], unitPrice: '1' }] }).expect(400);
  expect(await state(f)).toEqual(before);
});
test('empty cart and mismatched request preserve all state', async () => {
  const f = await fixture(); const before = await state(f);
  expect(((await create(f, f.key, { items: [{ ...f.input.items[0], qty: 1 }] }).expect(409)).body as ErrorBody).error.code).toBe('CONCURRENT_UPDATE');
  expect(await state(f)).toEqual(before); await prisma.cartItem.deleteMany({ where: { cartId: f.cart.id } });
  const empty = await state(f); await create(f).expect(400); expect(await state(f)).toEqual(empty);
});
test.each([0, 1])('unavailable/insufficient stock=%p leaves cart/stock/order/claim unchanged', async (stock) => {
  const f = await fixture(stock); const before = await state(f); expect(((await create(f).expect(409)).body as ErrorBody).error.code).toBe('OUT_OF_STOCK'); expect(await state(f)).toEqual(before);
});
test('invalid persisted topping association fails with full rollback', async () => {
  const f = await fixture(); await prisma.productTopping.delete({ where: { productId_toppingId: { productId: f.product.id, toppingId: f.topping.id } } });
  const before = await state(f); await create(f).expect(400); expect(await state(f)).toEqual(before);
});
test('normalized duplicate request configs merge; price drift uses new DB components', async () => {
  const f = await fixture(); await prisma.product.update({ where: { id: f.product.id }, data: { price: '40001' } });
  await prisma.productSize.update({ where: { productId_size: { productId: f.product.id, size: 'M' } }, data: { extraPrice: '5001' } });
  await prisma.topping.update({ where: { id: f.topping.id }, data: { price: '7001' } });
  const item = { ...f.input.items[0], productId: f.product.id.toUpperCase(), size: ' m ', toppingIds: [f.topping.id.toUpperCase()], qty: 1 };
  expect(((await create(f, f.key, { items: [item, item] }).expect(201)).body as OrderBody).total).toBe('104006');
  const replay = await create(f).expect(201); expect(replay.headers['idempotency-replayed']).toBe('true');
});
test('multiple configurations same Product decrement once by aggregate', async () => {
  const f = await fixture(5); await prisma.cartItem.create({ data: { cartId: f.cart.id, productId: f.product.id, size: 'L', qty: 3, configurationKey: [f.product.id, 'L'].join(':') } });
  const body = { items: [{ productId: f.product.id, size: 'L', qty: 3, toppingIds: [] }, ...f.input.items] };
  expect(((await create(f, f.key, body).expect(201)).body as OrderBody).subtotal).toBe('254000');
  expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toMatchObject({ stock: 0, version: 1 });
});
test('fixed promotion resolves/normalizes and snapshots capped discount', async () => {
  const f = await fixture(); const promotion = await prisma.promotion.create({ data: { code: randomUUID().replaceAll('-', '').toUpperCase(), discountAmount: '200000', minimumSubtotal: '0',
    startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01'), isActive: true } });
  const body = (await create(f, f.key, { ...f.input, promotionCode: ` ${promotion.code.toLowerCase()} ` }).expect(201)).body as OrderBody;
  expect(body).toMatchObject({ discountAmount: '104000', total: '0' });
  expect(await prisma.order.findUnique({ where: { id: body.id } })).toMatchObject({ promotionId: promotion.id, promotionCodeSnapshot: promotion.code });
});
test('invalid promotion rolls back and permits same key after correction', async () => {
  const f = await fixture(); const before = await state(f); await create(f, f.key, { ...f.input, promotionCode: 'ABSENT' }).expect(422);
  expect(await state(f)).toEqual(before); await create(f).expect(201);
});
test('exact Decimal maximum and initial PENDING', async () => {
  const f = await fixture(1, 1); await prisma.product.update({ where: { id: f.product.id }, data: { price: '999999987999' } });
  expect((await create(f).expect(201)).body).toMatchObject({ status: 'PENDING', total: '999999999999' });
});
test('same key replay survives active order, catalog drift and Cart change; different payload conflicts', async () => {
  const f = await fixture(); const first = await create(f).expect(201); await prisma.product.update({ where: { id: f.product.id }, data: { stock: 0, price: '1' } });
  const before = await state(f); const replay = await create(f).expect(201); expect(replay.body).toEqual(first.body); expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(((await create(f, f.key, { items: [{ ...f.input.items[0], qty: 1 }] }).expect(409)).body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED'); expect(await state(f)).toEqual(before);
});
test.each(['PENDING', 'PAYMENT_FAILED'] as const)('new key discovery and Cart write lock for %s; GET allowed', async (status) => {
  const f = await fixture(); const order = (await create(f).expect(201)).body as OrderBody;
  if (status === 'PAYMENT_FAILED') await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status } });
    await tx.product.update({ where: { id: f.product.id }, data: { stock: { increment: 2 }, version: { increment: 1 } } });
  });
  const before = await state(f); const blocked = await create(f, randomUUID()).expect(409);
  expect((blocked.body as ErrorBody).error).toMatchObject({ code: 'INVALID_ORDER_STATE', details: { existingOrderId: order.id } });
  await request(app.getHttpServer()).get('/cart').set('Authorization', `Bearer ${f.token}`).expect(200);
  const item = await prisma.cartItem.findFirstOrThrow({ where: { cartId: f.cart.id } });
  for (const method of ['post', 'patch', 'delete'] as const) {
    const path = method === 'post' ? '/cart/items' : `/cart/items/${item.id}`;
    const r = await request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${f.token}`).send(method === 'post' ? f.input.items[0] : method === 'patch' ? { qty: 1 } : {}).expect(409);
    expect((r.body as ErrorBody).error.details.existingOrderId).toBe(order.id);
  }
  expect(await state(f)).toEqual(before);
  await cancel(f, order.id).expect(200); await cancel(f, order.id).expect(200);
  expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toMatchObject({ stock: 10, version: 2 });
  await request(app.getHttpServer()).patch(`/cart/items/${item.id}`).set('Authorization', `Bearer ${f.token}`).send({ qty: 1 }).expect(200);
});
test('GET/cancel ownership isolation and invalid state/body', async () => {
  const f = await fixture(); const other = await fixture(); const order = (await create(f).expect(201)).body as OrderBody;
  await get(other, order.id).expect(404); await cancel(other, order.id).expect(404); await get(f, randomUUID()).expect(404);
  await request(app.getHttpServer()).get(`/orders/${order.id}`).expect(401); await cancel(f, order.id).send({ status: 'PAID' }).expect(400);
  await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID' } }); await cancel(f, order.id).expect(409);
});
test('actual PostgreSQL OrderItem failure rolls back stock/order/items/claim and preserves Cart', async () => {
  const f = await fixture(); const before = await state(f);
  await client.query(`CREATE FUNCTION fail_b10_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fault'; END $$`);
  await client.query(`CREATE TRIGGER fail_b10_item BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION fail_b10_item()`);
  try { const r = await create(f).expect(503); expect(r.text).not.toMatch(/test fault|Prisma|password|stack/); expect(await state(f)).toEqual(before); }
  finally { await client.query('DROP TRIGGER fail_b10_item ON order_items'); await client.query('DROP FUNCTION fail_b10_item()'); }
});
test('actual stock update failure rolls back all state', async () => {
  const f = await fixture(); const before = await state(f);
  await client.query(`CREATE FUNCTION fail_b10_stock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stock fault'; END $$`);
  await client.query('CREATE TRIGGER fail_b10_stock BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fail_b10_stock()');
  try { await create(f).expect(503); expect(await state(f)).toEqual(before); }
  finally { await client.query('DROP TRIGGER fail_b10_stock ON products'); await client.query('DROP FUNCTION fail_b10_stock()'); }
});
test('two users read same stock/version: exactly one wins OCC; loser Cart preserved', async () => {
  const a = await fixture(1, 1); const b = await fixture(1, 1);
  await prisma.cartItem.deleteMany({ where: { cartId: b.cart.id } });
  await prisma.cartItem.create({ data: { cartId: b.cart.id, productId: a.product.id, size: 'M', qty: 1, configurationKey: [a.product.id, 'M', a.topping.id].join(':'), toppings: { create: { toppingId: a.topping.id } } } });
  b.input = a.input;
  const pricing = app.get(PricingService); const original = pricing.validateCart.bind(pricing); let arrived = 0; let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const spy = jest.spyOn(pricing, 'validateCart').mockImplementation(async (...args) => { const result = await original(...args); if (++arrived === 2) release(); await gate; return result; });
  try {
    const rs = await Promise.all([create(a), create(b)]); expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((rs.find((r) => r.status === 409)?.body as ErrorBody).error.code).toBe('CONCURRENT_UPDATE');
    expect(await prisma.product.findUnique({ where: { id: a.product.id } })).toMatchObject({ stock: 0, version: 1 });
    expect(await prisma.order.count({ where: { userId: { in: [a.user.id, b.user.id] } } })).toBe(1);
    expect(await prisma.cartItem.count({ where: { cartId: { in: [a.cart.id, b.cart.id] } } })).toBe(2);
  } finally { release(); spy.mockRestore(); }
});
test('concurrent new keys same user cannot create two active orders', async () => {
  const f = await fixture(); const rs = await Promise.all([create(f), create(f, randomUUID())]);
  expect(rs.map((r) => r.status).sort()).toEqual([201, 409]); expect((rs.find((r) => r.status === 409)?.body as ErrorBody).error.code).toBe('INVALID_ORDER_STATE');
  expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(1); expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toMatchObject({ stock: 8, version: 1 });
});
test('concurrent same key yields same order or in-progress then exact replay', async () => {
  const f = await fixture(); const rs = await Promise.all([create(f), create(f)]);
  expect(rs.some((r) => r.status === 201)).toBe(true); expect(rs.every((r) => r.status === 201 || (r.status === 409 && (r.body as ErrorBody).error.code === 'IDEMPOTENCY_IN_PROGRESS'))).toBe(true);
  const replay = await create(f).expect(201); expect(rs.filter((r) => r.status === 201).every((r) => (r.body as OrderBody).id === (replay.body as OrderBody).id)).toBe(true);
  expect(await prisma.order.count({ where: { userId: f.user.id } })).toBe(1);
});
test('cancel concurrent/repeat restores aggregate quantity exactly once', async () => {
  const f = await fixture(); const order = (await create(f).expect(201)).body as OrderBody;
  const rs = await Promise.all([cancel(f, order.id), cancel(f, order.id)]); expect(rs.map((r) => r.status)).toEqual([200, 200]);
  expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toMatchObject({ stock: 10, version: 2 });
});
test('same key scoped separately across users', async () => {
  const a = await fixture(); const b = await fixture(); const key = randomUUID();
  const first = (await create(a, key).expect(201)).body as OrderBody; const second = (await create(b, key).expect(201)).body as OrderBody; expect(first.id).not.toBe(second.id);
});
test.each([0, -1, 100, 1.5, '2', null])('Order DTO rejects qty %p without writes', async (qty) => {
  const f = await fixture(); const before = await state(f);
  await create(f, f.key, { items: [{ ...f.input.items[0], qty }] }).expect(400); expect(await state(f)).toEqual(before);
});
test('concurrent Cart write/create serialize and cannot checkout a different confirmed quantity', async () => {
  const f = await fixture(); const item = await prisma.cartItem.findFirstOrThrow({ where: { cartId: f.cart.id } });
  const rs = await Promise.all([create(f), request(app.getHttpServer()).patch(`/cart/items/${item.id}`).set('Authorization', `Bearer ${f.token}`).send({ qty: 1 })]);
  const orders = await prisma.order.findMany({ where: { userId: f.user.id }, include: { items: true } });
  if (rs[0].status === 201) { expect(rs[1].status).toBe(409); expect(orders[0].items[0].qty).toBe(2); }
  else { expect(rs[0].status).toBe(409); expect((rs[0].body as ErrorBody).error.code).toBe('CONCURRENT_UPDATE'); expect(rs[1].status).toBe(200); expect(orders).toHaveLength(0); }
});
test('cancel restores multiple configurations by product once; preserves monetary snapshot', async () => {
  const f = await fixture(5); await prisma.cartItem.create({ data: { cartId: f.cart.id, productId: f.product.id, size: 'L', qty: 3, configurationKey: [f.product.id, 'L'].join(':') } });
  const body = { items: [...f.input.items, { productId: f.product.id, size: 'L', qty: 3, toppingIds: [] }] };
  const order = (await create(f, f.key, body).expect(201)).body as OrderBody;
  const cancelled = await cancel(f, order.id).expect(200); expect((cancelled.body as OrderBody).total).toBe(order.total);
  expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toMatchObject({ stock: 5, version: 2 });
});
test('50-configuration limit is applied after duplicate merge, not raw item count', async () => {
  const f = await fixture(99, 51);
  const body = { items: Array.from({ length: 51 }, () => ({ ...f.input.items[0], qty: 1 })) };
  const created = (await create(f, f.key, body).expect(201)).body as OrderBody;
  expect(created.items).toHaveLength(1); expect(created.total).toBe('2652000');
});

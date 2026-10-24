import { utcConnectionString } from '../../src/database/pg-connection';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client';
import { PricingService } from '../../src/pricing/pricing.service';
import { configureApp } from '../../src/common/configure-app';
import { PaymentExpirationWorker } from '../../src/orders/payment-expiration.worker';
import { PaymentReceiptWorker } from '../../src/payments/payment-receipt.worker';
import { OrderService } from '../../src/orders/order.service';
// Never fall back to the application's shared development/production database.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('Explicit isolated TEST_DATABASE_URL required');
const url = new URL(connectionString);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  || !/^\/brewlite_(orders|b2a)_[a-f0-9]{12}_test$/.test(url.pathname)
  || ['host', 'hostaddr', 'service'].some(key => url.searchParams.has(key))) throw new Error('Isolated local orders/b2a test database required');
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
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma)
    .overrideProvider(ConfigService).useValue(new ConfigService({ NODE_ENV: 'test', DATABASE_URL: connectionString,
      FRONTEND_ORIGIN: 'http://localhost:3000', JWT_SECRET: 'synthetic-orders-test-secret-at-least-32-bytes', JWT_EXPIRES_IN: 3600,
      PAYMENT_PROVIDER_MODE: 'MOCK', PAYMENT_MOCK_MODE: 'SUCCESS' }))
    .overrideProvider(PaymentExpirationWorker).useValue({}).overrideProvider(PaymentReceiptWorker).useValue({}).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
});
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
type OrderBody = { id: string; status: string; subtotal: string; total: string; discountAmount: string; items: { qty: number; unitPrice: string; lineTotal: string }[] };
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
  return { product: await prisma.product.findUnique({ where: { id: f.product.id } }), cart: await prisma.cart.findUnique({ where: { id: f.cart.id }, include: {
    items: { orderBy: { id: 'asc' }, include: { toppings: { orderBy: { toppingId: 'asc' } } } } } }),
    orders: await prisma.order.findMany({ where: { userId: f.user.id }, orderBy: { id: 'asc' }, include: {
      items: { orderBy: { id: 'asc' }, include: { toppings: { orderBy: { toppingId: 'asc' } } } } } }),
    claims: await prisma.idempotencyRequest.findMany({ where: { userId: f.user.id }, orderBy: { id: 'asc' } }),
    user: await prisma.user.findUnique({ where: { id: f.user.id } }),
    payments: await prisma.payment.findMany({ where: { userId: f.user.id }, orderBy: { id: 'asc' } }),
    awards: await prisma.loyaltyAward.findMany({ where: { userId: f.user.id }, orderBy: { id: 'asc' } }),
    entries: await prisma.loyaltyEntry.findMany({ where: { userId: f.user.id }, orderBy: { sequence: 'asc' } }) };
}
test('valid creation snapshots PENDING pricing, decrements stock and clears only owner Cart atomically', async () => {
  const other = await fixture(); const otherBefore = await state(other);
  const f = await fixture(); const before = await state(f); const r = await create(f).expect(201); const body = r.body as OrderBody;
  expect(body).toMatchObject({ status: 'PENDING', subtotal: '104000', discountAmount: '0', total: '104000', items: [{ unitPrice: '52000', lineTotal: '104000' }] });
  const after = await state(f); expect(after.cart).toMatchObject({ id: f.cart.id, items: [] }); expect(after.user).toEqual(before.user);
  expect(after.product).toMatchObject({ stock: 8, version: 1 }); expect(after.payments).toEqual([]); expect(after.awards).toEqual([]); expect(after.entries).toEqual([]);
  expect(await prisma.cartItemTopping.count({ where: { cartItemId: { in: before.cart?.items.map(item => item.id) ?? [] } } })).toBe(0);
  expect(await state(other)).toEqual(otherBefore);
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

test('missing persistent Cart is rejected without committing a claim or changing stock', async () => {
  const f = await fixture(); await prisma.cartItem.deleteMany({ where: { cartId: f.cart.id } });
  await prisma.cart.delete({ where: { id: f.cart.id } }); const before = await state(f);
  await create(f).expect(400); expect(await state(f)).toEqual(before);
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

test('different configurations cannot exceed shared Product stock in aggregate', async () => {
  const f = await fixture(3, 2);
  await prisma.cartItem.create({ data: { cartId: f.cart.id, productId: f.product.id, size: 'L', qty: 2, configurationKey: [f.product.id, 'L'].join(':') } });
  const before = await state(f);
  const r = await create(f, f.key, { items: [...f.input.items, { productId: f.product.id, size: 'L', qty: 2, toppingIds: [] }] }).expect(409);
  expect((r.body as ErrorBody).error.code).toBe('OUT_OF_STOCK'); expect(await state(f)).toEqual(before);
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
  const f = await fixture(); const first = await create(f).expect(201);
  await request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${f.token}`).send({ ...f.input.items[0], qty: 3 }).expect(201);
  await prisma.product.update({ where: { id: f.product.id }, data: { stock: 0, price: '1' } });
  const before = await state(f); const replay = await create(f).expect(201); expect(replay.body).toEqual(first.body); expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(((await create(f, f.key, { items: [{ ...f.input.items[0], qty: 1 }] }).expect(409)).body as ErrorBody).error.code).toBe('IDEMPOTENCY_KEY_REUSED'); expect(await state(f)).toEqual(before);
});
test.each(['PENDING', 'PAYMENT_FAILED'] as const)('active %s blocks only new checkout; Cart CRUD and cancellation preserve new Cart', async (status) => {
  const f = await fixture(); const order = (await create(f).expect(201)).body as OrderBody;
  if (status === 'PAYMENT_FAILED') await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status } });
    await tx.product.update({ where: { id: f.product.id }, data: { stock: { increment: 2 }, version: { increment: 1 } } });
  });
  const before = await state(f); const blocked = await create(f, randomUUID()).expect(409);
  expect((blocked.body as ErrorBody).error).toMatchObject({ code: 'INVALID_ORDER_STATE', details: { existingOrderId: order.id } });
  expect((await request(app.getHttpServer()).get('/cart').set('Authorization', `Bearer ${f.token}`).expect(200)).body).toMatchObject({ items: [] });
  expect(await state(f)).toEqual(before);
  await request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${f.token}`).send(f.input.items[0]).expect(201);
  const item = await prisma.cartItem.findFirstOrThrow({ where: { cartId: f.cart.id } });
  await request(app.getHttpServer()).patch(`/cart/items/${item.id}`).set('Authorization', `Bearer ${f.token}`).send({ qty: 3 }).expect(200);
  const edited = await state(f);
  expect((await create(f, randomUUID(), { items: [{ ...f.input.items[0], qty: 3 }] }).expect(409)).body).toMatchObject({ error: {
    code: 'INVALID_ORDER_STATE', details: { existingOrderId: order.id } } });
  expect(await state(f)).toEqual(edited);
  await request(app.getHttpServer()).delete(`/cart/items/${item.id}`).set('Authorization', `Bearer ${f.token}`).expect(200);
  await request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${f.token}`).send({ ...f.input.items[0], qty: 4 }).expect(201);
  const newCart = (await state(f)).cart;
  await cancel(f, order.id).expect(200); await cancel(f, order.id).expect(200);
  expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toMatchObject({ stock: 10, version: 2 });
  expect((await state(f)).cart).toEqual(newCart);
  expect((await state(f)).orders[0].items[0].qty).toBe(2);
  await create(f, randomUUID(), { items: [{ ...f.input.items[0], qty: 4 }] }).expect(201);
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
  const before = await Promise.all([state(a), state(b)]);
  const pricing = app.get(PricingService); const original = pricing.validateCart.bind(pricing); let arrived = 0; let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const spy = jest.spyOn(pricing, 'validateCart').mockImplementation(async (...args) => { const result = await original(...args); if (++arrived === 2) release(); await gate; return result; });
  try {
    const rs = await Promise.all([create(a), create(b)]); expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((rs.find((r) => r.status === 409)?.body as ErrorBody).error.code).toBe('CONCURRENT_UPDATE');
    expect(await prisma.product.findUnique({ where: { id: a.product.id } })).toMatchObject({ stock: 0, version: 1 });
    expect(await prisma.order.count({ where: { userId: { in: [a.user.id, b.user.id] } } })).toBe(1);
    const winnerIndex = rs.findIndex(r => r.status === 201); const loserIndex = 1 - winnerIndex;
    const after = await Promise.all([state(a), state(b)]);
    expect(after[winnerIndex].cart).toMatchObject({ items: [] });
    // Shared stock changes for the winner; every loser-owned row stays intact.
    expect({ ...after[loserIndex], product: before[loserIndex].product }).toEqual(before[loserIndex]);
    expect(after[winnerIndex].claims).toHaveLength(1);
    expect(await prisma.cartItem.count({ where: { cartId: { in: [a.cart.id, b.cart.id] } } })).toBe(1);
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
  const beforeReplay = await state(f);
  expect(beforeReplay.product).toMatchObject({ stock: 8, version: 1 }); expect(beforeReplay.cart).toMatchObject({ items: [] }); expect(beforeReplay.claims).toHaveLength(1);
  await create(f).expect(201); expect(await state(f)).toEqual(beforeReplay);
});
test('cancel concurrent/repeat restores aggregate quantity exactly once', async () => {
  const f = await fixture(); const order = (await create(f).expect(201)).body as OrderBody;
  const rs = await Promise.all([cancel(f, order.id), cancel(f, order.id)]); expect(rs.map((r) => r.status)).toEqual([200, 200]);
  expect(await prisma.product.findUnique({ where: { id: f.product.id } })).toMatchObject({ stock: 10, version: 2 });
  const beforeRepeat = await state(f); await cancel(f, order.id).expect(200); expect(await state(f)).toEqual(beforeRepeat);
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
  const after = await state(f);
  if (rs[0].status === 201) {
    expect(rs[1].status).toBe(404); expect((rs[1].body as ErrorBody).error.code).toBe('CART_ITEM_NOT_FOUND');
    expect(orders[0].items[0].qty).toBe(2); expect(after.cart).toMatchObject({ items: [] });
    expect(after.product).toMatchObject({ stock: 8, version: 1 }); expect(after.claims).toHaveLength(1);
  } else {
    expect(rs[0].status).toBe(409); expect((rs[0].body as ErrorBody).error.code).toBe('CONCURRENT_UPDATE'); expect(rs[1].status).toBe(200); expect(orders).toHaveLength(0);
    expect(after.cart?.items).toMatchObject([{ id: item.id, qty: 1 }]); expect(after.product).toEqual(f.product); expect(after.claims).toEqual([]);
  }
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

test.each(['STAFF', 'ADMIN'] as const)('POST /orders rejects DB role %s even with CUSTOMER in JWT', async (role) => {
  const f = await fixture(); await prisma.user.update({ where: { id: f.user.id }, data: { role } });
  f.token = jwt.sign({ sub: f.user.id, role: 'CUSTOMER' });
  const before = await state(f); await create(f).expect(403); expect(await state(f)).toEqual(before);
});

test('invalid/expired JWT and oversized idempotency key cannot write', async () => {
  const f = await fixture(); const before = await state(f);
  for (const token of ['invalid', jwt.sign({ sub: f.user.id }, { expiresIn: -1 }), jwt.sign({ sub: randomUUID() })]) {
    await request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', f.key).send(f.input).expect(401);
  }
  await create(f, 'x'.repeat(129)).expect(400); expect(await state(f)).toEqual(before);
});

test('create/replay/active/detail/cancel protect order data from caches and retain CORS Vary', async () => {
  const f = await fixture(); const first = await create(f).set('Origin', 'http://localhost:3000').expect(201);
  const order = first.body as OrderBody;
  const responses = [first, await create(f).set('Origin', 'http://localhost:3000').expect(201),
    await request(app.getHttpServer()).get('/orders/active').set('Authorization', `Bearer ${f.token}`).set('Origin', 'http://localhost:3000').expect(200),
    await get(f, order.id).set('Origin', 'http://localhost:3000').expect(200),
    await cancel(f, order.id).set('Origin', 'http://localhost:3000').expect(200)];
  for (const response of responses) {
    expect(response.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(response.headers.vary).toMatch(/Authorization/); expect(response.headers.vary).toMatch(/Origin/);
  }
  expect(responses[1].headers['idempotency-replayed']).toBe('true');
});

test.each([
  {}, { items: [] }, { items: null }, { items: {} }, { items: [null] }, { items: [[]] },
  { items: [{ qty: 1 }] }, { items: ['invalid'] },
])('missing/empty/malformed items %j are rejected without writes', async (body) => {
  const f = await fixture(); const before = await state(f);
  await create(f, f.key, body).expect(400); expect(await state(f)).toEqual(before);
});

test.each(['productId', 'size', 'qty', 'toppingIds'] as const)('missing item field %s is rejected without writes', async (field) => {
  const f = await fixture(); const before = await state(f); const item: Record<string, unknown> = { ...f.input.items[0] }; delete item[field];
  await create(f, f.key, { items: [item] }).expect(400); expect(await state(f)).toEqual(before);
});

test.each([
  { productId: 'not-a-uuid' }, { productId: null }, { size: 'XL' }, { size: 1 },
  { toppingIds: ['not-a-uuid'] }, { toppingIds: null }, { toppingIds: 'invalid' },
  { toppingIds: Array.from({ length: 11 }, () => randomUUID()) },
])('invalid item options %j are rejected without writes', async (options) => {
  const f = await fixture(); const before = await state(f);
  await create(f, f.key, { items: [{ ...f.input.items[0], ...options }] }).expect(400); expect(await state(f)).toEqual(before);
});

test('duplicate toppings are rejected after UUID case/whitespace normalization', async () => {
  const f = await fixture(); const before = await state(f);
  await create(f, f.key, { items: [{ ...f.input.items[0], toppingIds: [f.topping.id, ` ${f.topping.id.toUpperCase()} `] }] }).expect(400);
  expect(await state(f)).toEqual(before);
});

test.each(['status', 'total', 'stock', 'userId'])('nested client-controlled %s field is rejected without writes', async (field) => {
  const f = await fixture(); const before = await state(f);
  await create(f, f.key, { items: [{ ...f.input.items[0], [field]: 1 }] }).expect(400); expect(await state(f)).toEqual(before);
});

test.each([1, 99])('quantity boundary %i is accepted and stock is exact', async qty => {
  const f = await fixture(99, qty); const r = await create(f).expect(201);
  expect((r.body as OrderBody).items[0].qty).toBe(qty); expect((await state(f)).product).toMatchObject({ stock: 99 - qty, version: 1 });
  expect((await state(f)).cart).toMatchObject({ items: [] });
});

test('merged quantity over 99 and over 50 unique configurations are rejected before any writes', async () => {
  const f = await fixture(); const before = await state(f);
  await create(f, f.key, { items: [50, 50].map(qty => ({ ...f.input.items[0], qty })) }).expect(400);
  expect(await state(f)).toEqual(before);
  await create(f, f.key, { items: Array.from({ length: 51 }, () => ({ ...f.input.items[0], productId: randomUUID() })) }).expect(400);
  expect(await state(f)).toEqual(before);
});

test('exactly 50 distinct configurations succeed and consume their aggregated product stock once', async () => {
  const f = await fixture(99, 1);
  const extraToppings = Array.from({ length: 5 }, () => ({ id: randomUUID(), name: 'Extra', price: '1' }));
  await prisma.topping.createMany({ data: extraToppings });
  await prisma.productTopping.createMany({ data: extraToppings.map(t => ({ productId: f.product.id, toppingId: t.id })) });
  await prisma.cartItem.deleteMany({ where: { cartId: f.cart.id } });
  const ids = [f.topping.id, ...extraToppings.map(t => t.id)];
  const items = Array.from({ length: 50 }, (_, mask) => ({ productId: f.product.id, size: 'M', qty: 1,
    toppingIds: ids.filter((_, bit) => mask & (1 << bit)).sort() }));
  const rows = items.map(item => ({ id: randomUUID(), cartId: f.cart.id, productId: f.product.id, size: 'M', qty: 1,
    configurationKey: [item.productId, item.size, ...item.toppingIds].join(':') }));
  await prisma.cartItem.createMany({ data: rows });
  await prisma.cartItemTopping.createMany({ data: rows.flatMap((row, index) => items[index].toppingIds.map(toppingId => ({ cartItemId: row.id, toppingId }))) });
  const response = await create(f, f.key, { items }).expect(201);
  expect((response.body as OrderBody).items).toHaveLength(50);
  expect((await state(f)).product).toMatchObject({ stock: 49, version: 1 }); expect((await state(f)).cart).toMatchObject({ items: [] });
});

test.each([0, -1, 100, 1.5])('direct OrderService caller cannot bypass quantity bound %p', async qty => {
  const f = await fixture(); const before = await state(f);
  await expect(app.get(OrderService).create(f.user.id, f.key, { items: [{ ...f.input.items[0], qty }] })).rejects.toMatchObject({ status: 400 });
  expect(await state(f)).toEqual(before);
});

test.each(['cart_items', 'idempotency_requests'])('failure at %s after order snapshot rolls back Cart, stock and claim', async table => {
  const f = await fixture(); const before = await state(f);
  await client.query(`CREATE FUNCTION fail_checkout_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late checkout fault'; END $$`);
  const operation = table === 'cart_items' ? 'DELETE' : 'UPDATE';
  await client.query(`CREATE TRIGGER fail_checkout_commit BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_checkout_commit()`);
  try {
    const r = await create(f).expect(503); expect(r.text).not.toMatch(/late checkout fault|Prisma|password|stack/); expect(await state(f)).toEqual(before);
  } finally {
    await client.query(`DROP TRIGGER fail_checkout_commit ON ${table}`); await client.query('DROP FUNCTION fail_checkout_commit()');
  }
  // The rolled-back claim must not poison a retry using the same key.
  await create(f).expect(201);
});

test('cancel stock-restoration fault rolls back order state and preserves new Cart; retry restores once', async () => {
  const f = await fixture(); const order = (await create(f).expect(201)).body as OrderBody;
  await request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${f.token}`).send(f.input.items[0]).expect(201);
  const before = await state(f);
  await client.query(`CREATE FUNCTION fail_cancel_stock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'restore fault'; END $$`);
  await client.query('CREATE TRIGGER fail_cancel_stock BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fail_cancel_stock()');
  try { await cancel(f, order.id).expect(503); expect(await state(f)).toEqual(before); }
  finally { await client.query('DROP TRIGGER fail_cancel_stock ON products'); await client.query('DROP FUNCTION fail_cancel_stock()'); }
  await cancel(f, order.id).expect(200);
  expect((await state(f)).product).toMatchObject({ stock: 10, version: 2 }); expect((await state(f)).cart).toEqual(before.cart);
  const after = await state(f); await cancel(f, order.id).expect(200); expect(await state(f)).toEqual(after);
});

test('create replay after cancellation returns original PENDING without consuming new Cart or stock', async () => {
  const f = await fixture(); const first = await create(f).expect(201); const order = first.body as OrderBody;
  await cancel(f, order.id).expect(200);
  await request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${f.token}`).send(f.input.items[0]).expect(201);
  const before = await state(f); const replay = await create(f).expect(201);
  expect(replay.body).toEqual(first.body); expect(replay.headers['idempotency-replayed']).toBe('true'); expect(await state(f)).toEqual(before);
});

test('concurrent Cart add/create preserves quantities in either serial order', async () => {
  const f = await fixture();
  const rs = await Promise.all([create(f), request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${f.token}`).send(f.input.items[0])]);
  expect(rs[1].status).toBe(201); const after = await state(f);
  if (rs[0].status === 201) {
    expect(after.orders[0].items[0].qty).toBe(2); expect(after.cart?.items[0].qty).toBe(2);
    expect(after.product).toMatchObject({ stock: 8, version: 1 }); expect(after.claims).toHaveLength(1);
  } else {
    expect(rs[0].status).toBe(409); expect((rs[0].body as ErrorBody).error.code).toBe('CONCURRENT_UPDATE');
    expect(after.cart?.items[0].qty).toBe(4); expect(after.orders).toEqual([]); expect(after.claims).toEqual([]); expect(after.product).toEqual(f.product);
  }
});

test.each(['create', 'cancel'] as const)('%s maps technical raw SQL failures to 503, with no database changes', async operation => {
  const f = await fixture(); const order = operation === 'cancel' ? (await create(f).expect(201)).body as OrderBody : null;
  const before = await state(f);
  const spy = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('private SQL details', {
    code: 'P2010', clientVersion: 'test', meta: { code: '42P01' } }));
  try {
    const r = await (order ? cancel(f, order.id) : create(f)).expect(503);
    expect(r.text).not.toMatch(/private SQL details|42P01|Prisma/); expect(await state(f)).toEqual(before);
  } finally { spy.mockRestore(); }
});

test.each(['create', 'cancel'] as const)('%s retains 409 for PostgreSQL adapter lock contention', async operation => {
  const f = await fixture(); const order = operation === 'cancel' ? (await create(f).expect(201)).body as OrderBody : null;
  const before = await state(f);
  const spy = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('private lock details', {
    code: 'P2010', clientVersion: 'test', meta: { driverAdapterError: { cause: { originalCode: '55P03' } } } }));
  try {
    const r = await (order ? cancel(f, order.id) : create(f)).expect(409);
    expect((r.body as ErrorBody).error.code).toBe(order ? 'CONCURRENT_UPDATE' : 'IDEMPOTENCY_IN_PROGRESS');
    expect(await state(f)).toEqual(before);
  } finally { spy.mockRestore(); }
});

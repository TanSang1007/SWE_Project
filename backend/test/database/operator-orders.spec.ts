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
import { PrismaClient, type OrderStatus, type UserRole } from '../../src/generated/prisma/client';
import { OrderService } from '../../src/orders/order.service';
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { configureApp } from '../../src/common/configure-app';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local database required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test required');
const schema = `brewlite_a02_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const scopedUrl = new URL(connectionString); scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(scopedUrl.toString()) }, { schema }), log: [{ emit: 'event', level: 'query' }] });
const queries: string[] = []; prisma.$on('query', (event) => queries.push(event.query));
let app: NestExpressApplication; let jwt: JwtService; let mode: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
let staff: Actor; let admin: Actor; let customer: Actor;
type Actor = { id: string; token: string };
const orders = new Map<OrderStatus, string>(); let productId: string; let toppingId: string; let promotionId: string;
const summaryKeys = ['id', 'orderCode', 'status', 'total', 'currency', 'createdAt', 'earnedPoints', 'version', 'updatedAt', 'redeemedPoints', 'loyaltyDiscountAmount', 'redemptionState', 'estimatedEarnedPoints'].sort();
const summaries = (res: { body: unknown }) => (res.body as Awaited<ReturnType<OrderService['operatorHistory']>>).items;
async function actor(role: UserRole = 'CUSTOMER'): Promise<Actor> {
  const u = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only', role } });
  return { id: u.id, token: jwt.sign({ sub: u.id }) };
}
const get = (who: Actor, path = '/operator/orders') => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${who.token}`);
async function create(status: OrderStatus) {
  const owner = await actor(); const input = { productId, size: 'M', qty: 2, toppingIds: [toppingId] };
  await request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${owner.token}`).send(input).expect(201);
  const r = await request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${owner.token}`).set('Idempotency-Key', randomUUID())
    .send({ items: [input], promotionCode: 'A02SNAPSHOT' }).expect(201);
  const id = (r.body as { id: string }).id;
  if (status === 'CANCELLED') await request(app.getHttpServer()).post(`/orders/${id}/cancel`).set('Authorization', `Bearer ${owner.token}`).expect(200);
  else if (status !== 'PENDING') {
    mode = status === 'PAYMENT_FAILED' ? 'FAILURE' : 'SUCCESS';
    await request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${owner.token}`).set('Idempotency-Key', randomUUID()).send({ orderId: id, method: 'WALLET' }).expect(200);
    // Trusted test calls to existing B16 only; no A03 HTTP route is introduced.
    for (const target of ['PREPARING', 'READY', 'COMPLETED'] as const) {
      if (!['PREPARING', 'READY', 'COMPLETED'].includes(status)) break;
      const current = await prisma.order.findUniqueOrThrow({ where: { id } }); await app.get(OrderService).transitionOrder(id, current.version, target);
      if (target === status) break;
    }
  }
  mode = 'SUCCESS'; return id;
}
async function fingerprint() {
  const tables = (await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [schema])).rows;
  const result: Record<string, unknown> = {};
  for (const { table_name: name } of tables) result[name] = (await client.query(`SELECT to_jsonb(t) AS row FROM "${name}" t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
}
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter((n) => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma)
    .overrideProvider(MockPaymentService).useValue({ result: () => mode }).compile();
  app = m.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  staff = await actor('STAFF'); admin = await actor('ADMIN'); customer = await actor();
  productId = (await prisma.product.create({ data: { name: 'Historical drink', price: '45000', stock: 200, imageUrl: '/images/test.jpg', sizes: { create: { size: 'M', extraPrice: '5000' } } } })).id;
  toppingId = (await prisma.topping.create({ data: { name: 'Historical cream', price: '5000' } })).id;
  await prisma.productTopping.create({ data: { productId, toppingId } });
  promotionId = (await prisma.promotion.create({ data: { code: 'A02SNAPSHOT', discountAmount: '10000', minimumSubtotal: '0', startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01'), isActive: true } })).id;
});
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
test('empty list is read-only for STAFF and ADMIN', async () => {
  const before = await fingerprint(); expect((await get(staff).expect(200)).body).toEqual({ items: [] }); expect((await get(admin).expect(200)).body).toEqual({ items: [] }); expect(await fingerprint()).toEqual(before);
});
test('real customer checkout/payment/B16 fixtures span all legal statuses and owners', async () => {
  for (const status of ['PENDING', 'PAYMENT_FAILED', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'] as const) orders.set(status, await create(status));
  for (const who of [staff, admin]) {
    const allowed = who === staff ? ['PAID', 'PREPARING', 'READY'] : [...orders.keys()];
    const r = await get(who).expect(200); expect(summaries(r)).toHaveLength(allowed.length);
    expect(summaries(r).map((o) => o.status).sort()).toEqual(allowed.sort());
    expect(Object.keys(summaries(r)[0]).sort()).toEqual(summaryKeys);
  }
});
test.each(['PENDING', 'PAYMENT_FAILED', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'] as const)('status filter %s has exact current status/version and all-owner projection', async (status) => {
  const r = await get(admin).query({ status }).expect(200); expect(summaries(r)).toHaveLength(1);
  const db = await prisma.order.findUniqueOrThrow({ where: { id: orders.get(status)! } });
  expect(summaries(r)[0]).toMatchObject({ id: db.id, status: db.status, version: db.version, updatedAt: db.updatedAt.toISOString(), total: '100000' });
});
test('multiple timestamp ties sort deterministically by native UUID DESC', async () => {
  const tie = new Date('2026-10-07T00:00:00Z'); await prisma.order.updateMany({ data: { createdAt: tie } });
  const expected = [...orders.values()].sort((a, b) => b.localeCompare(a));
  for (const who of [staff, admin]) expect(summaries(await get(who).expect(200)).map((o) => o.id)).toEqual(who === admin ? expected : expected.filter(id => (['PAID', 'PREPARING', 'READY'] as const).some(status => orders.get(status) === id)));
});
test('details preserve exact snapshots/promotion/latest payment and revision metadata', async () => {
  for (const [status, id] of orders) {
    const db = await prisma.order.findUniqueOrThrow({ where: { id } }); const r = await get(admin, `/operator/orders/${id}`).expect(200);
    expect(r.body).toMatchObject({ id, status, version: db.version, updatedAt: db.updatedAt.toISOString(), total: '100000', subtotal: '110000', discountAmount: '10000', promotionCode: 'A02SNAPSHOT',
      items: [{ productName: 'Historical drink', size: 'M', qty: 2, unitPrice: '55000', lineTotal: '110000', toppings: [{ name: 'Historical cream', price: '5000' }] }],
      paymentStatus: ['PENDING', 'CANCELLED'].includes(status) ? null : status === 'PAYMENT_FAILED' ? 'FAILED' : 'SUCCEEDED',
      earnedPoints: ['PENDING', 'PAYMENT_FAILED'].includes(status) ? null : status === 'CANCELLED' ? 0 : 10 });
    expect(r.text).not.toMatch(/userId|email|passwordHash|idempotencyKey|loyaltyAward|requestHash/); expect(r.headers['cache-control']).toContain('no-store');
  }
  await get(admin, `/operator/orders/${orders.get('PAID')!}`).expect(200);
});
test('catalog/options/promotion drift does not reprice or rename historical order', async () => {
  const path = `/operator/orders/${orders.get('PAID')!}`; const before = (await get(admin, path).expect(200)).body as unknown;
  await prisma.product.update({ where: { id: productId }, data: { name: 'Changed', price: '1' } });
  await prisma.productSize.update({ where: { productId_size: { productId, size: 'M' } }, data: { extraPrice: '1' } });
  await prisma.topping.update({ where: { id: toppingId }, data: { name: 'Changed', price: '1' } });
  await prisma.promotion.update({ where: { id: promotionId }, data: { code: 'CHANGED', discountAmount: '1', isActive: false } });
  expect((await get(staff, path).expect(200)).body).toEqual(before);
});
test('all operator GETs/filters/repeated detail reads preserve every business row/timestamp', async () => {
  const before = await fingerprint();
  for (const who of [staff, admin]) { await get(who).expect(200); for (const [status, id] of orders) {
    const readable = who === admin || ['PAID', 'PREPARING', 'READY', 'COMPLETED'].includes(status);
    await get(who).query({ status }).expect(readable ? 200 : 403); await get(who, `/operator/orders/${id}`).expect(readable ? 200 : 404);
  } }
  expect(await fingerprint()).toEqual(before);
});
test.each(['PAID', 'PREPARING', 'READY', 'COMPLETED'] as const)('UI01 STAFF exact %s and detail are read-only', async status => {
  const before = await fingerprint(); const r = await get(staff).query({ status }).expect(200);
  expect(summaries(r).map(o => o.status)).toEqual([status]);
  await get(staff, `/operator/orders/${orders.get(status)!}`).expect(200); expect(await fingerprint()).toEqual(before);
});
test.each(['PENDING', 'PAYMENT_FAILED', 'CANCELLED'] as const)('UI01 STAFF cannot expose %s through ID/filter/forged authority', async status => {
  const before = await fingerprint(); const forged = { ...staff, token: jwt.sign({ sub: staff.id, role: 'ADMIN' }) };
  await get(forged).set('X-Role', 'ADMIN').query({ status }).expect(403);
  expect((await get(forged, `/operator/orders/${orders.get(status)!}`).set('X-Role', 'ADMIN').expect(404)).body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });
  expect(await fingerprint()).toEqual(before);
});
test('guest/invalid/expired JWT, CUSTOMER and forged role claims cannot read operator data', async () => {
  const before = await fingerprint();
  for (const path of ['/operator/orders', `/operator/orders/${orders.get('PAID')!}`]) {
    await request(app.getHttpServer()).get(path).expect(401); await get({ ...customer, token: 'invalid' }, path).expect(401);
    await get({ ...staff, token: jwt.sign({ sub: staff.id }, { expiresIn: -1 }) }, path).expect(401); await get(customer, path).expect(403);
    await get({ ...customer, token: jwt.sign({ sub: customer.id, role: 'ADMIN' }) }, path).expect(403);
  }
  expect(await fingerprint()).toEqual(before);
});
test('current DB role controls old token immediately; customer APIs retain ownership', async () => {
  await prisma.user.update({ where: { id: staff.id }, data: { role: 'CUSTOMER' } });
  try { await get(staff).expect(403); await get(staff, `/operator/orders/${orders.get('PAID')!}`).expect(403); }
  finally { await prisma.user.update({ where: { id: staff.id }, data: { role: 'STAFF' } }); }
  await get(staff).expect(200); await get(staff, '/orders/me').expect(403); await get(admin, `/orders/${orders.get('PAID')!}`).expect(403);
  expect((await get(customer, '/orders/me').expect(200)).body).toEqual({ items: [] }); await get(customer, `/orders/${orders.get('PAID')!}`).expect(404);
});
test('authorized missing resource404 and wrong role403 precedes UUID validation', async () => {
  expect((await get(staff, `/operator/orders/${randomUUID()}`).expect(404)).body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });
  await get(customer, '/operator/orders/invalid').expect(403); await get(staff, '/operator/orders/invalid').expect(400);
});
test('real database read error returns sanitized503 and recovery leaves every row unchanged', async () => {
  const before = await fingerprint(); await client.query('ALTER TABLE orders RENAME TO orders_a02_fault');
  try { for (const path of ['/operator/orders', `/operator/orders/${orders.get('PAID')!}`]) {
    const r = await get(staff, path).expect(503); expect(r.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } }); expect(r.text).not.toMatch(/Prisma|SQL|orders_a02_fault|schema|password/);
  } } finally { await client.query('ALTER TABLE orders_a02_fault RENAME TO orders'); }
  await get(staff).expect(200); expect(await fingerprint()).toEqual(before);
});
test('summary query count remains bounded for one versus many orders; no per-order DB loop', async () => {
  // Add many rows only in this isolated fixture schema, preserving valid unpaid snapshots.
  const original = await prisma.order.findUniqueOrThrow({ where: { id: orders.get('PENDING')! }, include: { items: { include: { toppings: true } } } });
  for (let n = 0; n < 20; n++) {
    const owner = await actor(); const id = randomUUID();
    await prisma.order.create({ data: { id, userId: owner.id, orderCode: `BL-${id}`, status: 'PENDING', subtotal: original.subtotal,
      discountAmount: original.discountAmount, total: original.total, promotionId, promotionCodeSnapshot: original.promotionCodeSnapshot,
      items: { create: original.items.map((i) => ({ productId: i.productId, productNameSnapshot: i.productNameSnapshot, size: i.size, qty: i.qty,
        basePrice: i.basePrice, sizeExtraPrice: i.sizeExtraPrice, unitPrice: i.unitPrice, lineTotal: i.lineTotal,
        toppings: { create: i.toppings.map((t) => ({ toppingId: t.toppingId, toppingNameSnapshot: t.toppingNameSnapshot, priceSnapshot: t.priceSnapshot })) } })) } } });
    await prisma.product.update({ where: { id: productId }, data: { stock: { decrement: 2 }, version: { increment: 1 } } });
  }
  const before = await fingerprint(); queries.length = 0; await get(admin).query({ status: 'READY' }).expect(200); const one = queries.length;
  queries.length = 0; const r = await get(admin).expect(200); const many = queries.length;
  expect(summaries(r)).toHaveLength(27); expect(many).toBe(one); expect(many).toBeLessThanOrEqual(3);
  console.info(JSON.stringify({ A02QueryCount: { oneOrder: one, twentySevenOrders: many } }));
  expect(queries.some((q) => q.includes('"status"') && q.includes('"version"') && q.includes('"updated_at"'))).toBe(true);
  expect(await fingerprint()).toEqual(before);
});
test('UI01 ADMIN demotion applies STAFF scope to the same old token', async () => {
  const before = await fingerprint(); await prisma.user.update({ where: { id: admin.id }, data: { role: 'STAFF' } });
  try {
    expect(summaries(await get(admin).expect(200)).every(o => ['PAID', 'PREPARING', 'READY'].includes(o.status))).toBe(true);
    await get(admin).query({ status: 'PENDING' }).expect(403);
    await get(admin, `/operator/orders/${orders.get('PENDING')!}`).expect(404);
  } finally { await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } }); }
  expect(await fingerprint()).toEqual(before);
});
test('UI01 real A03 workflow moves active Order to completed history without other business writes', async () => {
  const id = orders.get('PAID')!; const before = await fingerprint();
  for (const targetStatus of ['PREPARING', 'READY', 'COMPLETED']) {
    const current = await prisma.order.findUniqueOrThrow({ where: { id } });
    await request(app.getHttpServer()).post(`/operator/orders/${id}/transitions`).set('Authorization', `Bearer ${staff.token}`).send({ expectedVersion: current.version, targetStatus }).expect(200);
    expect(summaries(await get(staff).expect(200)).some(o => o.id === id)).toBe(targetStatus !== 'COMPLETED');
  }
  expect(summaries(await get(staff).query({ status: 'COMPLETED' }).expect(200)).some(o => o.id === id)).toBe(true);
  const after = await fingerprint(); delete before.orders; delete after.orders; expect(after).toEqual(before);
});
test('UI01 real Payment makes Order visible; ADMIN paid-cancel hides STAFF detail and queue', async () => {
  const id = orders.get('PENDING')!; const pending = await prisma.order.findUniqueOrThrow({ where: { id } });
  mode = 'SUCCESS';
  await request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${jwt.sign({ sub: pending.userId })}`).set('Idempotency-Key', randomUUID()).send({ orderId: id, method: 'WALLET' }).expect(200);
  expect(summaries(await get(staff).expect(200)).some(o => o.id === id)).toBe(true);
  const paid = await prisma.order.findUniqueOrThrow({ where: { id } });
  const payment = await prisma.payment.findMany({ where: { orderId: id } });
  await get(staff, `/operator/orders/${id}`).expect(200);
  await request(app.getHttpServer()).post(`/admin/orders/${id}/paid-cancel`).set('Authorization', `Bearer ${admin.token}`).send({ expectedVersion: paid.version }).expect(200);
  expect(summaries(await get(staff).expect(200)).some(o => o.id === id)).toBe(false);
  await get(staff, `/operator/orders/${id}`).expect(404); await get(admin, `/operator/orders/${id}`).expect(200);
  expect(await prisma.payment.findMany({ where: { orderId: id } })).toEqual(payment);
  const stable = await fingerprint(); await get(staff).expect(200); await get(staff, `/operator/orders/${id}`).expect(404); expect(await fingerprint()).toEqual(stable);
});
test('UI01 concurrent completion retains original version OCC and one winning transition', async () => {
  const id = orders.get('READY')!; const current = await prisma.order.findUniqueOrThrow({ where: { id } });
  const responses = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post(`/operator/orders/${id}/transitions`).set('Authorization', `Bearer ${staff.token}`).send({ expectedVersion: current.version, targetStatus: 'COMPLETED' })));
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect(await prisma.order.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'COMPLETED', version: current.version + 1 });
});

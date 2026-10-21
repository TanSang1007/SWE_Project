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
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { configureApp } from '../../src/common/configure-app';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local database required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test required');
const schema = `brewlite_b15_test_${randomUUID().replaceAll('-', '')}`;
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
type HistoryItem = { id: string; orderCode: string; status: string; total: string; currency: string; createdAt: string; earnedPoints: number | null };
async function user() {
  const row = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only' } });
  return { id: row.id, token: jwt.sign({ sub: row.id }) };
}
type Owner = Awaited<ReturnType<typeof user>>;
const get = (owner: Owner, path = '/orders/me') => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${owner.token}`);
const items = async (owner: Owner) => ((await get(owner).expect(200)).body as { items: HistoryItem[] }).items;
const pay = (owner: Owner, id: string, key = randomUUID()) => request(app.getHttpServer()).post('/payments')
  .set('Authorization', `Bearer ${owner.token}`).set('Idempotency-Key', key).send({ orderId: id, method: 'WALLET' });
const cancel = (owner: Owner, id: string) => request(app.getHttpServer()).post(`/orders/${id}/cancel`).set('Authorization', `Bearer ${owner.token}`);
async function create(owner: Owner, price = '45000', discount?: string) {
  const product = await prisma.product.create({ data: { name: 'Historical drink', price, stock: 100, imageUrl: '/images/test.jpg', sizes: { create: { size: 'M', extraPrice: '5000' } } } });
  const topping = await prisma.topping.create({ data: { name: 'Historical cream', price: '5000' } });
  await prisma.productTopping.create({ data: { productId: product.id, toppingId: topping.id } });
  const cart = await prisma.cart.upsert({ where: { userId: owner.id }, create: { userId: owner.id }, update: {} });
  // Fixture owner only, after the previous Order reached PAID/CANCELLED.
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  const input = { productId: product.id, size: 'M', qty: 2, toppingIds: [topping.id] };
  await request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${owner.token}`).send(input).expect(201);
  let promotionCode: string | undefined; let promotionId: string | undefined;
  if (discount) {
    const promotion = await prisma.promotion.create({ data: { code: randomUUID().replaceAll('-', '').toUpperCase(), discountAmount: discount,
      minimumSubtotal: '0', startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01'), isActive: true } });
    promotionCode = promotion.code; promotionId = promotion.id;
  }
  const r = await request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${owner.token}`).set('Idempotency-Key', randomUUID())
    .send({ items: [input], ...(promotionCode ? { promotionCode } : {}) }).expect(201);
  return { id: (r.body as { id: string }).id, productId: product.id, toppingId: topping.id, promotionCode, promotionId };
}
async function snapshot() {
  const tables = (await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [schema])).rows;
  const result: Record<string, unknown> = {};
  for (const { table_name } of tables) {
    const quoted = '"' + table_name.replaceAll('"', '""') + '"';
    result[table_name] = (await client.query(`SELECT to_jsonb(t) AS row FROM ${quoted} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
test('new user history is empty and creates no Cart/Order/claim', async () => {
  const owner = await user(); const before = await snapshot(); expect(await items(owner)).toEqual([]); expect(await snapshot()).toEqual(before);
});
test('one unpaid Order uses exact additive summary and no private data/pagination fields', async () => {
  const owner = await user(); const o = await create(owner); const list = await items(owner);
  expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ id: o.id, status: 'PENDING', total: '110000', earnedPoints: null, currency: 'VND' });
  expect(Object.keys(list[0]).sort()).toEqual(['createdAt','currency','earnedPoints','id','loyaltyDiscountAmount','orderCode','redeemedPoints','redemptionState','status','total']);
});
test('A/B/C: real create/payment/failure/cancel lifecycles appear with correct points and latest Payment detail', async () => {
  const owner = await user(); const paid = await create(owner, '45000', '10000'); await pay(owner, paid.id).expect(200);
  const failed = await create(owner); mode = 'FAILURE'; await pay(owner, failed.id).expect(200);
  expect(await items(owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: paid.id, status: 'PAID', total: '100000', earnedPoints: 10 }),
    expect.objectContaining({ id: failed.id, status: 'PAYMENT_FAILED', earnedPoints: null })]));
  expect((await get(owner, '/orders/' + failed.id).expect(200)).body).toMatchObject({ paymentStatus: 'FAILED', paidAt: null, earnedPoints: null });
  await cancel(owner, failed.id).expect(200); expect(await items(owner)).toEqual(expect.arrayContaining([expect.objectContaining({ id: failed.id, status: 'CANCELLED', earnedPoints: 0 })]));
});
test('D: multiple Orders sort by createdAt DESC and UUID DESC for exact timestamp ties', async () => {
  const owner = await user(); const a = await create(owner); await cancel(owner, a.id).expect(200);
  const b = await create(owner); await cancel(owner, b.id).expect(200); const c = await create(owner); await pay(owner, c.id).expect(200);
  const tie = new Date('2026-10-07T00:00:00Z'); await prisma.order.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { createdAt: tie } });
  await prisma.order.update({ where: { id: c.id }, data: { createdAt: new Date('2026-10-08T00:00:00Z') } });
  const expected = [c.id, ...[a.id, b.id].sort((x, y) => y.localeCompare(x))];
  expect((await items(owner)).map((o) => o.id)).toEqual(expected); expect((await items(owner)).map((o) => o.id)).toEqual(expected);
});
test('E/F: fresh JWT re-login reads persistent history; another user gets empty and common404 detail', async () => {
  const a = await user(); const b = await user(); const o = await create(a); await pay(a, o.id).expect(200);
  const relogin = { ...a, token: jwt.sign({ sub: a.id }) }; expect((await items(relogin)).map((item) => item.id)).toEqual([o.id]);
  expect(await items(b)).toEqual([]); await get(b, '/orders/' + o.id).expect(404); await get(b).query({ userId: a.id }).expect(400);
});
test('detail snapshot names/options/prices/promotion remains unchanged after catalog/config drift', async () => {
  const owner = await user(); const o = await create(owner, '45000', '10000'); await pay(owner, o.id).expect(200);
  const before = (await get(owner, '/orders/' + o.id).expect(200)).body as unknown;
  await prisma.product.update({ where: { id: o.productId }, data: { name: 'Renamed', price: '1' } });
  await prisma.productSize.update({ where: { productId_size: { productId: o.productId, size: 'M' } }, data: { extraPrice: '1' } });
  await prisma.topping.update({ where: { id: o.toppingId }, data: { name: 'Renamed topping', price: '1' } });
  await prisma.productTopping.deleteMany({ where: { productId: o.productId } });
  await prisma.promotion.update({ where: { id: o.promotionId! }, data: { code: 'CHANGED' + o.promotionCode!.slice(0, 20), isActive: false, discountAmount: '1' } });
  expect((await get(owner, '/orders/' + o.id).expect(200)).body).toEqual(before);
  expect((await items(owner))[0]).toMatchObject({ total: '100000', earnedPoints: 10 });
});
test('GET history/details including repeated reads never mutate any fixture business table/timestamp', async () => {
  const owner = await user(); const paid = await create(owner); await pay(owner, paid.id).expect(200);
  const failed = await create(owner); mode = 'FAILURE'; await pay(owner, failed.id).expect(200); const before = await snapshot();
  for (let n = 0; n < 3; n++) { await get(owner).expect(200); await get(owner, '/orders/' + paid.id).expect(200); await get(owner, '/orders/' + failed.id).expect(200); }
  expect(await snapshot()).toEqual(before);
});
test('read all existing preparation/terminal statuses with active award; no B16 transition service implemented', async () => {
  const owner = await user(); const o = await create(owner); await pay(owner, o.id).expect(200);
  for (const status of ['PREPARING', 'READY', 'COMPLETED'] as const) {
    // Isolated fixture follows allowed status edges only; this is projection coverage, not B16 workflow acceptance.
    await prisma.order.update({ where: { id: o.id }, data: { status, version: { increment: 1 } } });
    expect((await items(owner))[0]).toMatchObject({ status, earnedPoints: 11 });
    expect((await get(owner, '/orders/' + o.id).expect(200)).body).toMatchObject({ status, earnedPoints: 11, paymentStatus: 'SUCCEEDED' });
  }
});
test('zero-total paid Order returns numeric0 award, while unpaid/cancelled remain distinct', async () => {
  const owner = await user(); const o = await create(owner, '45000', '200000'); await pay(owner, o.id).expect(200);
  expect((await items(owner))[0]).toMatchObject({ total: '0', earnedPoints: 0, status: 'PAID' });
  expect((await get(owner, '/orders/' + o.id).expect(200)).body).toMatchObject({ paidAt: expect.any(String) as unknown, earnedPoints: 0, paymentStatus: 'SUCCEEDED' });
});
test('history/detail reject auth and unsupported owner/status/pagination/body inputs', async () => {
  const owner = await user(); const o = await create(owner);
  await request(app.getHttpServer()).get('/orders/me').expect(401); await request(app.getHttpServer()).get('/orders/' + o.id).expect(401);
  for (const field of ['userId', 'limit', 'offset', 'cursor', 'status']) await get(owner).query({ [field]: owner.id }).expect(400);
  await get(owner).send({ userId: owner.id, status: 'PAID' }).expect(400); await get(owner, '/orders/' + o.id).send({ total: '0' }).expect(400);
  const token = jwt.sign({ sub: owner.id }, { expiresIn: -1 }); await request(app.getHttpServer()).get('/orders/me').set('Authorization', `Bearer ${token}`).expect(401);
});

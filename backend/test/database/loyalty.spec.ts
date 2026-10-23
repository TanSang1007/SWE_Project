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
const schema = `brewlite_b14_test_${randomUUID().replaceAll('-', '')}`;
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
afterAll(async () => {  if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
async function user() {
  const row = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only' } });
  return { id: row.id, token: jwt.sign({ sub: row.id }) };
}
type Owner = Awaited<ReturnType<typeof user>>;
const balance = (owner: Owner) => request(app.getHttpServer()).get('/loyalty').set('Authorization', `Bearer ${owner.token}`);
async function order(owner: Owner, price = '95000', discount?: string) {
  const product = await prisma.product.create({ data: { name: 'B14 Drink', price, stock: 10, imageUrl: '/images/test.jpg', sizes: { create: { size: 'S', extraPrice: '0' } } } });
  const cart = await prisma.cart.upsert({ where: { userId: owner.id }, create: { userId: owner.id }, update: {} });
  await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, size: 'S', qty: 1, configurationKey: `${product.id}:S` } });
  let promotionCode: string | undefined;
  if (discount) {
    const promotion = await prisma.promotion.create({ data: { code: randomUUID().replaceAll('-', '').toUpperCase(), discountAmount: discount,
      minimumSubtotal: '0', startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01'), isActive: true } });
    promotionCode = promotion.code;
  }
  const r = await request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${owner.token}`).set('Idempotency-Key', randomUUID())
    .send({ items: [{ productId: product.id, size: 'S', qty: 1, toppingIds: [] }], ...(promotionCode ? { promotionCode } : {}) }).expect(201);
  return { id: (r.body as { id: string }).id, productId: product.id };
}
const pay = (owner: Owner, orderId: string, key = randomUUID()) => request(app.getHttpServer()).post('/payments')
  .set('Authorization', `Bearer ${owner.token}`).set('Idempotency-Key', key).send({ orderId, method: 'WALLET' });
async function ledger(owner: Owner) {
  return { user: await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
    awards: await prisma.loyaltyAward.findMany({ where: { userId: owner.id }, orderBy: { id: 'asc' } }) };
}
test('A: zero -> PENDING unchanged -> SUCCESS award9; balance uses persisted value and repeated reads never mutate', async () => {
  const a = await user(); expect((await balance(a).expect(200)).body).toEqual({ loyaltyPoints: 0, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
  const o = await order(a); expect((await balance(a).expect(200)).body).toEqual({ loyaltyPoints: 0, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
  await pay(a, o.id).expect(200); const before = await ledger(a);
  expect(before.awards).toHaveLength(1); expect(before.awards[0]).toMatchObject({ orderId: o.id, userId: a.id, points: 9 });
  for (let n = 0; n < 3; n++) expect((await balance(a).expect(200)).body).toEqual({ loyaltyPoints: 9, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
  expect(await ledger(a)).toEqual(before);
  await prisma.product.update({ where: { id: o.productId }, data: { price: '1' } });
  expect((await balance(a).expect(200)).body).toEqual({ loyaltyPoints: 9, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
});
test('B: SUCCESS same-key replay and new-key rejection leave award and balance unchanged', async () => {
  const a = await user(); const o = await order(a); const key = randomUUID(); const first = await pay(a, o.id, key).expect(200); const before = await ledger(a);
  expect((await pay(a, o.id, key).expect(200)).body).toEqual(first.body); await pay(a, o.id).expect(409);
  expect((await balance(a).expect(200)).body).toEqual({ loyaltyPoints: 9, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" }); expect(await ledger(a)).toEqual(before);
});
test('C/D: failed attempt/replay no points; SUCCESS retry once; old FAILED replay keeps current balance', async () => {
  const a = await user(); const o = await order(a); mode = 'FAILURE'; const failedKey = randomUUID(); const failed = await pay(a, o.id, failedKey).expect(200);
  expect((await balance(a).expect(200)).body).toEqual({ loyaltyPoints: 0, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" }); expect((await ledger(a)).awards).toHaveLength(0);
  expect((await pay(a, o.id, failedKey).expect(200)).body).toEqual(failed.body);
  mode = 'SUCCESS'; const successKey = randomUUID(); await pay(a, o.id, successKey).expect(200); await pay(a, o.id, successKey).expect(200);
  await pay(a, o.id, failedKey).expect(200);
  expect((await balance(a).expect(200)).body).toEqual({ loyaltyPoints: 9, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" }); expect((await ledger(a)).awards).toHaveLength(1);
});
test('E: promotion snapshot95000 awards9; later successful9000 Order records zero award and balance remains9', async () => {
  const a = await user(); const discounted = await order(a, '105000', '10000'); await pay(a, discounted.id).expect(200);
  expect((await balance(a).expect(200)).body).toEqual({ loyaltyPoints: 9, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" }); const small = await order(a, '9000'); await pay(a, small.id).expect(200);
  const s = await ledger(a); expect(s.awards).toHaveLength(2); expect(s.awards.find((award) => award.orderId === small.id)?.points).toBe(0);
  expect((await balance(a).expect(200)).body).toEqual({ loyaltyPoints: 9, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
  expect(s.user.loyaltyPoints).toBe(s.awards.reduce((sum, award) => sum + award.points, 0));
});
test('JWT isolation, invalid/expired tokens and injected owner/body/query never expose another balance', async () => {
  const a = await user(); const b = await user(); const o = await order(a); await pay(a, o.id).expect(200);
  expect((await balance(b).expect(200)).body).toEqual({ loyaltyPoints: 0, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
  await balance(b).query({ userId: a.id }).expect(400); await balance(b).send({ userId: a.id, loyaltyPoints: 9 }).expect(400);
  await request(app.getHttpServer()).get(`/loyalty/${a.id}`).expect(404);
  await request(app.getHttpServer()).get('/loyalty').expect(401);
  for (const token of ['invalid', jwt.sign({ sub: a.id }, { expiresIn: -1 })]) await request(app.getHttpServer()).get('/loyalty').set('Authorization', `Bearer ${token}`).expect(401);
});
test('concurrent  payments produce one award; balance matches ledger and reads do not add points', async () => {
  const a = await user(); const o = await order(a); const rs = await Promise.all([pay(a, o.id), pay(a, o.id)]);
  expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  const s = await ledger(a); expect(s.awards).toHaveLength(1); expect(s.user.loyaltyPoints).toBe(9);
  expect((await balance(a).expect(200)).body).toEqual({ loyaltyPoints: 9, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
});

import { utcConnectionString } from '../../src/database/pg-connection';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
const schema = `brewlite_b13_test_${randomUUID().replaceAll('-', '')}`;
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
async function fixture(discount = '10000', price = '52001') {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only' } });
  const product = await prisma.product.create({ data: { name: 'Promotion drink', price, stock: 5, imageUrl: '/images/test.jpg', sizes: { create: { size: 'M', extraPrice: '0' } } } });
  const item = { productId: product.id, size: 'M', qty: 2, toppingIds: [] };
  await prisma.cart.create({ data: { userId: user.id, items: { create: { productId: product.id, size: 'M', qty: 2, configurationKey: `${product.id}:M` } } } });
  const promotion = await prisma.promotion.create({ data: { code: randomUUID().replaceAll('-', '').toUpperCase(), discountAmount: discount,
    minimumSubtotal: '0', startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01'), isActive: true } });
  return { user, product, promotion, token: jwt.sign({ sub: user.id }), input: { items: [item], promotionCode: promotion.code }, key: randomUUID() };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type OrderBody = { id: string; subtotal: string; discountAmount: string; total: string; promotionCode: string | null };
type ErrorBody = { error: { code: string; message: string } };
const create = (f: Fixture, input: object = f.input, key = f.key) => request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${f.token}`).set('Idempotency-Key', key).send(input);
const pay = (f: Fixture, id: string, key = randomUUID()) => request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${f.token}`).set('Idempotency-Key', key).send({ orderId: id, method: 'WALLET' });
const get = (f: Fixture, id: string) => request(app.getHttpServer()).get(`/orders/${id}`).set('Authorization', `Bearer ${f.token}`);
async function state(f: Fixture) {
  return { product: await prisma.product.findUnique({ where: { id: f.product.id } }),
    cart: await prisma.cart.findUnique({ where: { userId: f.user.id }, include: { items: true } }),
    user: await prisma.user.findUnique({ where: { id: f.user.id } }),
    orders: await prisma.order.findMany({ where: { userId: f.user.id }, include: { items: true } }),
    claims: await prisma.idempotencyRequest.findMany({ where: { userId: f.user.id }, orderBy: { id: 'asc' } }),
    payments: await prisma.payment.findMany({ where: { userId: f.user.id } }), awards: await prisma.loyaltyAward.findMany({ where: { userId: f.user.id } }) };
}
test('promotion-only CLI creates no catalog/business rows and reruns without changing the Promotion', async () => {
  const names = (await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' AND table_name<>'promotions' ORDER BY table_name", [schema])).rows;
  const snapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const { table_name: name } of names) {
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      rows[name] = (await client.query(`SELECT to_jsonb(t) AS row FROM ${quoted} t ORDER BY to_jsonb(t)::text`)).rows;
    }
    return rows;
  };
  const before = await snapshot();
  const runSeed = () => execFileSync(process.execPath, [resolve(__dirname, '../../prisma/seed.cjs'), '--promotion-only'], { env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: scopedUrl.toString() }, stdio: 'pipe' });
  runSeed(); const first = await prisma.promotion.findMany();
  expect(first).toHaveLength(1); expect(first[0]).toMatchObject({ code: 'BREW10K', isActive: true });
  runSeed(); expect(await prisma.promotion.findMany()).toEqual(first); expect(await snapshot()).toEqual(before);
});
test('omitted promotion gives zero discount; unused invalid DB promotion is never required', async () => {
  const f = await fixture(); await prisma.promotion.update({ where: { id: f.promotion.id }, data: { isActive: false } });
  const r = await create(f, { items: f.input.items }).expect(201);
  expect(r.body).toMatchObject({ subtotal: '104002', discountAmount: '0', total: '104002', promotionCode: null });
  expect(await prisma.order.findUnique({ where: { id: (r.body as OrderBody).id } })).toMatchObject({ promotionId: null, promotionCodeSnapshot: null });
});
test.each([
  ['1', '1', '104001', 10], ['10000', '10000', '94002', 9], ['104002', '104002', '0', 0], ['200000', '104002', '0', 0],
])('configured fixed discount %s: snapshots, Payment amount and exact after-discount Loyalty', async (configured, discount, total, points) => {
  const f = await fixture(configured);
  const r = await create(f, { ...f.input, promotionCode: ` ${f.promotion.code.toLowerCase()} ` }).expect(201); const order = r.body as OrderBody;
  expect(order).toMatchObject({ subtotal: '104002', discountAmount: discount, total, promotionCode: f.promotion.code });
  const pending = await state(f); expect(pending.awards).toHaveLength(0); expect(pending.user?.loyaltyPoints).toBe(0); expect(pending.cart?.items).toHaveLength(1);
  expect(pending.orders[0]).toMatchObject({ promotionId: f.promotion.id, promotionCodeSnapshot: f.promotion.code });
  const key = randomUUID(); const paid = await pay(f, order.id, key).expect(200);
  expect(paid.body).toMatchObject({ payment: { amount: total, status: 'SUCCEEDED' }, loyalty: { awardedPoints: points } });
  const final = await state(f); expect(final.product).toEqual(pending.product); expect(final.orders[0].total.toFixed(0)).toBe(total);
  expect(final.awards).toHaveLength(1); expect(final.awards[0].points).toBe(points); expect(final.user?.loyaltyPoints).toBe(points); expect(final.cart?.items).toHaveLength(0);
  const replay = await pay(f, order.id, key).expect(200); expect(replay.body).toEqual(paid.body); expect(await state(f)).toEqual(final);
});
test.each(['missing', 'inactive', 'future', 'expired', 'minimum'])('invalid promotion %s returns sanitized422 with complete rollback', async (kind) => {
  const f = await fixture();
  if (kind === 'inactive') await prisma.promotion.update({ where: { id: f.promotion.id }, data: { isActive: false } });
  if (kind === 'future') await prisma.promotion.update({ where: { id: f.promotion.id }, data: { startsAt: new Date('2099-01-01') } });
  if (kind === 'expired') await prisma.promotion.update({ where: { id: f.promotion.id }, data: { endsAt: new Date('2021-01-01') } });
  if (kind === 'minimum') await prisma.promotion.update({ where: { id: f.promotion.id }, data: { minimumSubtotal: '104003' } });
  const before = await state(f); const r = await create(f, { ...f.input, promotionCode: kind === 'missing' ? 'ABSENT' : f.promotion.code }).expect(422);
  expect((r.body as ErrorBody).error.code).toBe('PROMOTION_INVALID'); expect(JSON.stringify(r.body)).not.toMatch(/Prisma|SELECT|passwordHash|stack/);
  expect(await state(f)).toEqual(before);
});
test('minimum subtotal equality is eligible', async () => {
  const f = await fixture(); await prisma.promotion.update({ where: { id: f.promotion.id }, data: { minimumSubtotal: '104002' } });
  await create(f).expect(201);
});
test.each(['discountAmount', 'configuredDiscount', 'promotionId', 'total'])('client cannot inject %s even with a valid code', async (field) => {
  const f = await fixture(); const before = await state(f); await create(f, { ...f.input, [field]: '1' }).expect(400); expect(await state(f)).toEqual(before);
});
test.each(['', ' ', null, 10, 'X'.repeat(33)])('invalid promotion code syntax %p rejects before writes', async (promotionCode) => {
  const f = await fixture(); const before = await state(f); await create(f, { ...f.input, promotionCode }).expect(400); expect(await state(f)).toEqual(before);
});
test('DB rejects zero and negative configured discounts (baseline CHECK >0)', async () => {
  const f = await fixture(); for (const discountAmount of ['0', '-1']) await expect(prisma.promotion.update({ where: { id: f.promotion.id }, data: { discountAmount } })).rejects.toThrow();
  expect((await prisma.promotion.findUniqueOrThrow({ where: { id: f.promotion.id } })).discountAmount.toFixed(0)).toBe('10000');
});
test('maximum integer VND discount/subtotal are exact with one-dong remainder', async () => {
  const f = await fixture('999999999998', '999999999999');
  await prisma.cartItem.updateMany({ where: { cart: { userId: f.user.id } }, data: { qty: 1 } });
  const order = (await create(f, { ...f.input, items: [{ ...f.input.items[0], qty: 1 }] }).expect(201)).body as OrderBody;
  expect(order).toMatchObject({ subtotal: '999999999999', discountAmount: '999999999998', total: '1' });
  expect((await pay(f, order.id).expect(200)).body).toMatchObject({ payment: { amount: '1' }, loyalty: { awardedPoints: 0 } });
});
test('changed code/amount/minimum/validity after creation never reprices GET, create replay or failed Payment retry', async () => {
  const f = await fixture('19999'); const created = await create(f).expect(201); const order = created.body as OrderBody;
  mode = 'FAILURE'; const oldKey = randomUUID(); const failed = await pay(f, order.id, oldKey).expect(200);
  expect((await state(f)).awards).toHaveLength(0);
  await prisma.promotion.update({ where: { id: f.promotion.id }, data: { code: 'CHANGED' + f.promotion.code.slice(0, 20), discountAmount: '1', minimumSubtotal: '999999999999', isActive: false, endsAt: new Date('2021-01-01') } });
  expect((await get(f, order.id).expect(200)).body).toMatchObject({ promotionCode: f.promotion.code, discountAmount: '19999', total: '84003' });
  const replay = await create(f).expect(201); expect(replay.body).toEqual(created.body); expect(replay.headers['idempotency-replayed']).toBe('true');
  mode = 'SUCCESS'; const key = randomUUID(); const paid = await pay(f, order.id, key).expect(200);
  expect(paid.body).toMatchObject({ payment: { amount: '84003' }, loyalty: { awardedPoints: 8 } });
  const final = await state(f); expect(final.user?.loyaltyPoints).toBe(8); expect(final.awards).toHaveLength(1);
  expect((await pay(f, order.id, oldKey).expect(200)).body).toEqual(failed.body);
  expect((await pay(f, order.id, key).expect(200)).body).toEqual(paid.body); expect(await state(f)).toEqual(final);
});
test('concurrent same-key promoted checkout creates one snapshot and consumes stock once', async () => {
  const f = await fixture(); const results = await Promise.all([create(f), create(f)]);
  expect(results.some((r) => r.status === 201)).toBe(true); expect(results.every((r) => [201, 409].includes(r.status))).toBe(true);
  const replay = (await create(f).expect(201)).body as OrderBody; const s = await state(f);
  expect(s.orders).toHaveLength(1); expect(s.orders[0].id).toBe(replay.id); expect(s.product).toMatchObject({ stock: 3, version: 1 }); expect(s.claims).toHaveLength(1); expect(s.awards).toHaveLength(0);
});
test('concurrent new-key promoted checkout cannot produce two active Orders', async () => {
  const f = await fixture(); const results = await Promise.all([create(f), create(f, f.input, randomUUID())]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]); const s = await state(f);
  expect(s.orders).toHaveLength(1); expect(s.product).toMatchObject({ stock: 3, version: 1 }); expect(s.claims).toHaveLength(1);
});
test('database fault after promoted stock write rolls back stock/Order/claim/Cart', async () => {
  const f = await fixture(); const before = await state(f);
  await client.query(`CREATE FUNCTION promotion_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test fault'; END $$`);
  await client.query('CREATE TRIGGER promotion_fault BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION promotion_fault()');
  try { await create(f).expect(503); expect(await state(f)).toEqual(before); }
  finally { await client.query('DROP TRIGGER promotion_fault ON orders'); await client.query('DROP FUNCTION promotion_fault()'); }
  await create(f).expect(201);
});
test('demo seed is repeatable and preserves edited promotion configuration and consumed stock', async () => {
  const runSeed = () => execFileSync(process.execPath, [resolve(__dirname, '../../prisma/seed.cjs')], { env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: scopedUrl.toString() }, stdio: 'pipe' });
  runSeed();
  const id = '44444444-4444-4444-8444-444444444441'; const productId = '11111111-1111-4111-8111-111111111111';
  expect(await prisma.promotion.findUnique({ where: { id } })).toMatchObject({ code: 'BREW10K', isActive: true });
  await prisma.promotion.update({ where: { id }, data: { discountAmount: '12345', isActive: false } });
  await prisma.product.update({ where: { id: productId }, data: { stock: 3, version: 7 } });
  const before = await prisma.promotion.findUnique({ where: { id } }); runSeed();
  expect(await prisma.promotion.findUnique({ where: { id } })).toEqual(before); expect(await prisma.promotion.count({ where: { code: 'BREW10K' } })).toBe(1);
  expect(await prisma.product.findUnique({ where: { id: productId } })).toMatchObject({ stock: 3, version: 7 });
});

import { utcConnectionString } from '../../src/database/pg-connection';
import { legacyAwardFixture } from './loyalty-fixture';
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
import { PrismaClient, type UserRole } from '../../src/generated/prisma/client';
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { configureApp } from '../../src/common/configure-app';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local database required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test required');
const schema = `brewlite_a03_test_${randomUUID().replaceAll('-', '')}`; const client = new Client({ connectionString });
const scopedUrl = new URL(connectionString); scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(scopedUrl.toString()) }, { schema }) });
let app: NestExpressApplication; let jwt: JwtService; let staff: Actor; let second: Actor; let admin: Actor; let customer: Actor;
let mode: 'SUCCESS' | 'FAILURE' = 'SUCCESS'; type Actor = { id: string; token: string };
async function actor(role: UserRole = 'CUSTOMER'): Promise<Actor> {
  const row = await prisma.user.create({ data: { role, email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only' } });
  return { id: row.id, token: jwt.sign({ sub: row.id }) };
}
const auth = (who: Actor, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${who.token}`);
const prepare = (who: Actor, id: string, expectedVersion: number, targetStatus = 'PREPARING') => request(app.getHttpServer()).post(`/operator/orders/${id}/transitions`)
  .set('Authorization', `Bearer ${who.token}`).send({ expectedVersion, targetStatus });
const cancel = (who: Actor, id: string, expectedVersion: number) => request(app.getHttpServer()).post(`/admin/orders/${id}/paid-cancel`)
  .set('Authorization', `Bearer ${who.token}`).send({ expectedVersion });
async function fixture(paid = true, price = '30000', owner?: Actor) {
  const who = owner ?? await actor(); const products = [];
  for (let n = 0; n < 2; n++) products.push(await prisma.product.create({ data: { name: `A03 snapshot ${n}`, price, stock: 100, imageUrl: '/images/test.jpg',
    sizes: { create: [{ size: 'M', extraPrice: '0' }, { size: 'L', extraPrice: '0' }] } } }));
  const items = [{ productId: products[0].id, size: 'M', qty: 2, toppingIds: [] }, { productId: products[0].id, size: 'L', qty: 1, toppingIds: [] }, { productId: products[1].id, size: 'M', qty: 1, toppingIds: [] }];
  for (const item of items) await request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${who.token}`).send(item).expect(201);
  const r = await request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${who.token}`).set('Idempotency-Key', randomUUID()).send({ items }).expect(201);
  const id = (r.body as { id: string }).id; const key = randomUUID();
  if (paid) await request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${who.token}`).set('Idempotency-Key', key).send({ orderId: id, method: 'WALLET' }).expect(200);
  return { id, who, products: products.map((p) => p.id).sort(), key };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const row = (f: Fixture) => prisma.order.findUniqueOrThrow({ where: { id: f.id } });
async function state(f: Fixture) {
  return { order: await prisma.order.findUniqueOrThrow({ where: { id: f.id }, include: { items: { orderBy: { id: 'asc' }, include: { toppings: true } } } }),
    products: await prisma.product.findMany({ where: { id: { in: f.products } }, orderBy: { id: 'asc' } }),
    user: await prisma.user.findUniqueOrThrow({ where: { id: f.who.id } }), payments: await prisma.payment.findMany({ where: { userId: f.who.id }, orderBy: { id: 'asc' } }),
    awards: await prisma.loyaltyAward.findMany({ where: { userId: f.who.id }, orderBy: { id: 'asc' } }),
    cart: await prisma.cart.findUnique({ where: { userId: f.who.id }, include: { items: true } }),
    claims: await prisma.idempotencyRequest.findMany({ where: { userId: f.who.id }, orderBy: { id: 'asc' } }) };
}
async function fingerprint() {
  const tables = (await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [schema])).rows;
  const values: Record<string, unknown> = {}; for (const { table_name: name } of tables) values[name] = (await client.query(`SELECT to_jsonb(t) AS row FROM "${name}" t ORDER BY to_jsonb(t)::text`)).rows; return values;
}
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations'); for (const name of readdirSync(dir).filter((n) => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(MockPaymentService).useValue({ result: () => mode }).compile();
  app = m.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  staff = await actor('STAFF'); second = await actor('STAFF'); admin = await actor('ADMIN'); customer = await actor();
});
beforeEach(() => { mode = 'SUCCESS'; });
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
test.each(['STAFF', 'ADMIN'] as const)('%s real HTTP preparation finishes without stock/payment/award/Cart effects; customer sees COMPLETED', async (role) => {
  const who = role === 'STAFF' ? staff : admin; const f = await fixture(); const before = await state(f); let version = before.order.version;
  for (const target of ['PREPARING', 'READY', 'COMPLETED']) {
    const r = await prepare(who, f.id, version, target).expect(200); expect(r.body).toMatchObject({ status: target, earnedPoints: 12, paymentStatus: 'SUCCEEDED' }); expect(r.body).not.toHaveProperty('version'); expect(r.body).not.toHaveProperty('updatedAt');
    version++; expect((await auth(who, `/operator/orders/${f.id}`).expect(200)).body).toMatchObject({ status: target, version });
  }
  const after = await state(f); expect(after.order.items).toEqual(before.order.items); expect(after.order.paidAt).toEqual(before.order.paidAt);
  for (const key of ['products', 'user', 'payments', 'awards', 'cart', 'claims'] as const) expect(after[key]).toEqual(before[key]);
  expect((await auth(f.who, `/orders/${f.id}`).expect(200)).body).toMatchObject({ status: 'COMPLETED', total: '120000', earnedPoints: 12 });
  expect((await auth(f.who, '/orders/me').expect(200)).body).toMatchObject({ items: [expect.objectContaining({ status: 'COMPLETED' })] });
});
test('ADMIN cancellation aggregates3+1 quantities, reverses12 once, preserves Payment/paidAt/snapshots/Cart/claims', async () => {
  const f = await fixture(); const before = await state(f); await cancel(admin, f.id, before.order.version).expect(200); const after = await state(f);
  expect(after.order.status).toBe('CANCELLED'); expect(after.order.version).toBe(before.order.version + 1); expect(after.order.items).toEqual(before.order.items); expect(after.order.paidAt).toEqual(before.order.paidAt);
  expect(after.products.map((p) => p.stock)).toEqual([100, 100]); expect(after.products.map((p) => p.version)).toEqual(before.products.map((p) => p.version + 1));
  expect(after.awards[0]).toMatchObject({ points: 12, reversedAt: expect.any(Date) as unknown }); expect(after.user.loyaltyPoints).toBe(0);
  for (const key of ['payments', 'cart', 'claims'] as const) expect(after[key]).toEqual(before[key]);
  expect((await auth(f.who, `/orders/${f.id}`).expect(200)).body).toMatchObject({ status: 'CANCELLED', earnedPoints: 0, paymentStatus: 'SUCCEEDED', total: '120000' });
  expect((await auth(f.who, '/loyalty').expect(200)).body).toEqual({ loyaltyPoints: 0, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
  const unchanged = await fingerprint(); await cancel(admin, f.id, before.order.version).expect(200); await cancel(staff, f.id, before.order.version).expect(403); expect(await fingerprint()).toEqual(unchanged);
});
test('zero award is marked reversed; original award7, not current formula12, is reversed exactly', async () => {
  for (const price of ['1', '30000']) {
    const f = await fixture(price !== '30000', price);
    if (price === '30000') await legacyAwardFixture(prisma, f.id, 7);
    await cancel(admin, f.id, (await row(f)).version).expect(200); const after = await state(f); expect(after.user.loyaltyPoints).toBe(0); expect(after.awards[0].points).toBe(price === '1' ? 0 : 7); expect(after.awards[0].reversedAt).not.toBeNull();
  }
});
test('guest/invalid/CUSTOMER/forged roles/STAFF cancel403 do not mutate any table', async () => {
  const f = await fixture(); const before = await fingerprint(); const v = (await row(f)).version;
  for (const path of [`/operator/orders/${f.id}/transitions`, `/admin/orders/${f.id}/paid-cancel`]) {
    await request(app.getHttpServer()).post(path).send({ expectedVersion: v, targetStatus: 'PREPARING' }).expect(401);
    await request(app.getHttpServer()).post(path).set('Authorization', 'Bearer invalid').send({ expectedVersion: v }).expect(401);
    for (const token of [customer.token, jwt.sign({ sub: customer.id, role: 'ADMIN' })]) await request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`).set('X-Role', 'ADMIN').send({ expectedVersion: v, targetStatus: 'PREPARING' }).expect(403);
  }
  await cancel(staff, f.id, v).expect(403); expect(await fingerprint()).toEqual(before);
});
test('DB demotion affects same old token on next mutation', async () => {
  const f = await fixture(); const v = (await row(f)).version; await prisma.user.update({ where: { id: admin.id }, data: { role: 'STAFF' } });
  try { const before = await fingerprint(); await cancel(admin, f.id, v).expect(403); expect(await fingerprint()).toEqual(before); await prepare(admin, f.id, v).expect(200); }
  finally { await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } }); }
});
test.each(['READY', 'COMPLETED'])('PAID skipped target%s409 leaves every business row unchanged', async (target) => {
  const f = await fixture(); const before = await fingerprint(); await prepare(staff, f.id, (await row(f)).version, target).expect(409); expect(await fingerprint()).toEqual(before);
});
test.each(['PREPARING', 'READY', 'COMPLETED'])('paid-cancel refuses %s without effects', async (status) => {
  const f = await fixture(); for (const target of ['PREPARING', 'READY', 'COMPLETED']) { await prepare(staff, f.id, (await row(f)).version, target).expect(200); if (target === status) break; }
  const before = await fingerprint(); await cancel(admin, f.id, (await row(f)).version).expect(409); expect(await fingerprint()).toEqual(before);
});
test('terminal/duplicate/stale requests preserve exact B16 error ordering and do not auto retry', async () => {
  const f = await fixture(); const v = (await row(f)).version; await prepare(staff, f.id, v).expect(200); const before = await fingerprint();
  expect((await prepare(second, f.id, v).expect(409)).body).toMatchObject({ error: { code: 'INVALID_ORDER_STATE' } });
  expect((await prepare(second, f.id, v, 'READY').expect(409)).body).toMatchObject({ error: { code: 'CONCURRENT_UPDATE' } }); expect(await fingerprint()).toEqual(before);
  await prepare(staff, f.id, v + 1, 'READY').expect(200); await prepare(staff, f.id, v + 2, 'COMPLETED').expect(200);
  const completed = await fingerprint(); for (const target of ['PREPARING', 'READY', 'COMPLETED']) await prepare(staff, f.id, v + 3, target).expect(409); expect(await fingerprint()).toEqual(completed);
});
test('two STAFF sessions update one Order only once', async () => {
  const f = await fixture(); const before = await state(f); const results = await Promise.all([prepare(staff, f.id, before.order.version), prepare(second, f.id, before.order.version)]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]); const after = await state(f); expect(after.order.version).toBe(before.order.version + 1); expect(after.order.status).toBe('PREPARING'); expect(after.products).toEqual(before.products); expect(after.awards).toEqual(before.awards);
});
test('ADMIN cancel versus STAFF prepare has exactly one winning graph edge', async () => {
  const f = await fixture(); const before = await state(f); const r = await Promise.all([cancel(admin, f.id, before.order.version), prepare(staff, f.id, before.order.version)]);
  expect(r.map((x) => x.status).sort()).toEqual([200, 409]); const after = await state(f); const cancelled = after.order.status === 'CANCELLED'; expect(after.order.version).toBe(before.order.version + 1);
  expect(after.products.map((p) => p.stock)).toEqual(cancelled ? [100, 100] : before.products.map((p) => p.stock)); expect(after.user.loyaltyPoints).toBe(cancelled ? 0 : 12); expect(after.payments).toEqual(before.payments);
});
test('concurrent repeated ADMIN cancellation restores/reverses only once', async () => {
  const f = await fixture(); const v = (await row(f)).version; const r = await Promise.all([cancel(admin, f.id, v), cancel(admin, f.id, v)]); expect(r.every((x) => x.status === 200)).toBe(true);
  const after = await state(f); expect(after.order.version).toBe(v + 1); expect(after.products.map((p) => p.stock)).toEqual([100, 100]); expect(after.user.loyaltyPoints).toBe(0); expect(after.awards).toHaveLength(1);
});
test.each(['orders', 'products', 'loyalty_awards', 'users'])('actual AFTER UPDATE fault at%s503 rolls back every HTTP cancellation write', async (table) => {
  const f = await fixture(); const before = await fingerprint(); const condition = table === 'products' ? `IF NEW.id <> '${f.products[1]}'::uuid THEN RETURN NEW; END IF;` : '';
  await client.query(`CREATE FUNCTION fail_a03() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${condition} RAISE EXCEPTION 'injected private fault'; END $$`);
  await client.query(`CREATE TRIGGER fault_a03 AFTER UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_a03()`);
  try { const r = await cancel(admin, f.id, (await row(f)).version).expect(503); expect(r.text).not.toMatch(/injected|private|Prisma|SQL/); expect(await fingerprint()).toEqual(before); }
  finally { await client.query(`DROP TRIGGER fault_a03 ON ${table}`); await client.query('DROP FUNCTION fail_a03()'); }
  await cancel(admin, f.id, (await row(f)).version).expect(200);
});
test('owner lock timeout409 rolls back; operator row is not the engine lock owner', async () => {
  const f = await fixture(); const v = (await row(f)).version; const before = await fingerprint(); await client.query('BEGIN'); await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.who.id]);
  try { expect((await prepare(staff, f.id, v).expect(409)).body).toMatchObject({ error: { code: 'CONCURRENT_UPDATE' } }); } finally { await client.query('ROLLBACK'); }
  expect(await fingerprint()).toEqual(before); await client.query('BEGIN'); await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [staff.id]);
  try { await prepare(staff, f.id, v).expect(200); } finally { await client.query('ROLLBACK'); }
});
test('HTTP cancel concurrent with customer payment preserves new award and immutable historical replay', async () => {
  const f = await fixture(); const g = await fixture(false, '30000', f.who); const v = (await row(f)).version;
  const pay = () => request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${g.who.token}`).set('Idempotency-Key', g.key).send({ orderId: g.id, method: 'CARD' });
  await Promise.all([cancel(admin, f.id, v).expect(200), pay().expect(200)]); const after = await state(f); expect(after.user.loyaltyPoints).toBe(12);
  const before = await fingerprint(); await request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${f.who.token}`).set('Idempotency-Key', f.key).send({ orderId: f.id, method: 'WALLET' }).expect(200);
  expect(await fingerprint()).toEqual(before);
});
test('unpaid Orders cannot use operator actions; valid missing Order404 and invalid DTO400', async () => {
  const f = await fixture(false); let before = await fingerprint(); await prepare(staff, f.id, (await row(f)).version).expect(409); await cancel(admin, f.id, (await row(f)).version).expect(409); expect(await fingerprint()).toEqual(before);
  mode = 'FAILURE'; await request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${f.who.token}`).set('Idempotency-Key', f.key).send({ orderId: f.id, method: 'WALLET' }).expect(200);
  before = await fingerprint(); await cancel(admin, f.id, (await row(f)).version).expect(409); await prepare(staff, f.id, (await row(f)).version).expect(409);
  await prepare(staff, randomUUID(), 0).expect(404); await prepare(staff, f.id, -1).expect(400); expect(await fingerprint()).toEqual(before);
});

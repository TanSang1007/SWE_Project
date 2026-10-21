import { utcConnectionString } from '../../src/database/pg-connection';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PrismaClient, type Prisma, type UserRole } from '../../src/generated/prisma/client';
import { AdminInventoryService } from '../../src/catalog/admin-inventory.service';
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { configureApp } from '../../src/common/configure-app';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local test DB required');
const url = new URL(connectionString); if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test required');
const schema = `brewlite_a06_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString, `-c search_path=${schema}`) }, { schema }) });
type Actor = { id: string; token: string };
let app: NestExpressApplication, jwt: JwtService, admin: Actor, staff: Actor, customer: Actor, inventory: AdminInventoryService;
let mode = 'SUCCESS';
async function actor(role: UserRole = 'CUSTOMER'): Promise<Actor> { const row = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only', role } }); return { id: row.id, token: jwt.sign({ sub: row.id }) }; }
const api = (method: 'get' | 'post' | 'patch', path: string, who?: Actor, body?: object) => {
  const call = request(app.getHttpServer())[method](path); if (who) call.set('Authorization', `Bearer ${who.token}`); return body ? call.send(body) : call;
};
const adjust = (id: string, delta: number, expectedVersion = 0, key = randomUUID(), who = admin) => api('post', `/admin/products/${id}/inventory-adjustments`, who, { delta, expectedVersion }).set('Idempotency-Key', key);
const row = (id: string) => prisma.product.findUniqueOrThrow({ where: { id } });
async function product(stock = 10, isActive = true, sizes = ['M']) { return prisma.product.create({ data: { name: 'A06 fixture', price: '45000', imageUrl: '/images/cappuccino.svg', stock, isActive, sizes: { create: sizes.map(size => ({ size, extraPrice: '0' })) } } }); }
async function history() {
  const result: Record<string, unknown> = {};
  for (const table of ['orders', 'order_items', 'order_item_toppings', 'payments', 'loyalty_awards', 'users']) result[table] = (await client.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
}
async function checkout(state: 'PENDING' | 'FAILED' | 'PAID') {
  const p = await product(), who = await actor(); const item = { productId: p.id, size: 'M', qty: 1, toppingIds: [] };
  await api('post', '/cart/items', who, item).expect(201);
  const order = await api('post', '/orders', who, { items: [item] }).set('Idempotency-Key', randomUUID()).expect(201);
  const id = (order.body as { id: string }).id;
  if (state !== 'PENDING') { mode = state === 'FAILED' ? 'FAILURE' : 'SUCCESS'; await api('post', '/payments', who, { orderId: id, method: 'WALLET' }).set('Idempotency-Key', randomUUID()).expect(200); mode = 'SUCCESS'; }
  return { p: await row(p.id), who, item, id };
}
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(MockPaymentService).useValue({ result: () => mode }).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService); inventory = app.get(AdminInventoryService);
  admin = await actor('ADMIN'); staff = await actor('STAFF'); customer = await actor();
});
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
beforeEach(() => { mode = 'SUCCESS'; });
test('ADMIN inventory GET is exact, sorted, current and read-only; empty initial list', async () => {
  expect((await api('get', '/admin/inventory', admin).expect(200)).body).toEqual({ items: [] });
  const p = await product(), inactive = await product(0, false); const before = await history();
  const result = await api('get', '/admin/inventory', admin).expect(200);
  expect(result.headers['cache-control']).toContain('no-store'); expect(result.headers.vary).toContain('Authorization');
  const items = (result.body as { items: object[] }).items;
  expect(items).toEqual([p, inactive].sort((a, b) => a.id.localeCompare(b.id)).map(x => ({ productId: x.id, productName: x.name, stock: x.stock, version: 0 })));
  expect(await history()).toEqual(before);
});
test('increase/decrease persist stock/version/result with no Order/Payment/Loyalty/user side effects', async () => {
  const p = await product(), before = await history();
  expect((await adjust(p.id, 5).expect(200)).body).toEqual({ productId: p.id, delta: 5, previousStock: 10, stock: 15, version: 1 });
  expect((await adjust(p.id, -3, 1).expect(200)).body).toEqual({ productId: p.id, delta: -3, previousStock: 15, stock: 12, version: 2 });
  expect(await row(p.id)).toMatchObject({ stock: 12, version: 2, price: p.price, isActive: true }); expect(await history()).toEqual(before);
  expect(await prisma.idempotencyRequest.findMany({ where: { operation: 'ADJUST_INVENTORY', responseBody: { path: ['productId'], equals: p.id } } })).toHaveLength(2);
});
test.each([0, 1.5, '1', null, 2147483648, -2147483648])('strict delta rejects %p', async delta => {
  const p = await product(); await api('post', `/admin/products/${p.id}/inventory-adjustments`, admin, { delta, expectedVersion: 0 }).set('Idempotency-Key', randomUUID()).expect(400);
  expect(await row(p.id)).toMatchObject({ stock: 10, version: 0 });
});
test('whitelist/header/query/version/UUID validation cannot mass assign', async () => {
  const p = await product(); const path = `/admin/products/${p.id}/inventory-adjustments`;
  await api('post', path, admin, { delta: 1, expectedVersion: 0 }).expect(400);
  await api('post', path, admin, { delta: 1, expectedVersion: 0 }).set('Idempotency-Key', 'bad key').expect(400);
  for (const body of [{ delta: 1 }, { delta: 1, expectedVersion: '0' }, { delta: 1, expectedVersion: -1 }, { delta: 1, expectedVersion: 0, stock: 999 }, { delta: 1, expectedVersion: 0, role: 'ADMIN' }]) await api('post', path, admin, body).set('Idempotency-Key', randomUUID()).expect(400);
  await api('post', path + '?stock=4', admin, { delta: 1, expectedVersion: 0 }).set('Idempotency-Key', randomUUID()).expect(400);
  await api('get', '/admin/inventory?sort=name', admin).expect(400); await adjust(randomUUID(), 1).expect(404);
  await api('post', '/admin/products/invalid/inventory-adjustments', admin, { delta: 1, expectedVersion: 0 }).set('Idempotency-Key', randomUUID()).expect(400);
  expect(await row(p.id)).toMatchObject({ stock: 10, version: 0 });
});
test('underflow/overflow/version limit reject atomically; failed claim may reuse same key corrected', async () => {
  const p = await product(), key = randomUUID(); const count = await prisma.idempotencyRequest.count();
  await adjust(p.id, -11, 0, key).expect(409); expect(await prisma.idempotencyRequest.count()).toBe(count);
  await adjust(p.id, 1, 0, key).expect(200);
  const max = await product(2147483647); await adjust(max.id, 1).expect(409);
  await prisma.product.update({ where: { id: max.id }, data: { version: 2147483647 } }); await adjust(max.id, -1, 2147483647).expect(503);
  expect(await row(max.id)).toMatchObject({ stock: 2147483647, version: 2147483647 });
});
test('stale expectedVersion returns CONCURRENT_UPDATE; no claim committed', async () => {
  const p = await product(); await adjust(p.id, 1).expect(200); const count = await prisma.idempotencyRequest.count();
  const result = await adjust(p.id, 3).expect(409); expect(result.body).toMatchObject({ error: { code: 'CONCURRENT_UPDATE' } });
  expect(await row(p.id)).toMatchObject({ stock: 11, version: 1 }); expect(await prisma.idempotencyRequest.count()).toBe(count);
});
test('lost-response replay is exact before current version/resource checks; mismatch in product/delta/version', async () => {
  const p = await product(), key = randomUUID(); const first = await adjust(p.id, 2, 0, key).expect(200);
  await adjust(p.id, 3, 1).expect(200); const replay = await adjust(p.id, 2, 0, key).expect(200);
  expect(replay.body).toEqual(first.body); expect(replay.headers['idempotency-replayed']).toBe('true'); expect(await row(p.id)).toMatchObject({ stock: 15, version: 2 });
  const normalized = await api('post', `/admin/products/${p.id.toUpperCase()}/inventory-adjustments`, admin, { expectedVersion: 0, delta: 2 }).set('Idempotency-Key', key).expect(200);
  expect(normalized.body).toEqual(first.body); expect(normalized.headers['idempotency-replayed']).toBe('true');
  for (const [id, delta, version] of [[p.id, 3, 0], [p.id, 2, 1], [randomUUID(), 2, 0]] as [string, number, number][]) {
    expect((await adjust(id, delta, version, key).expect(409)).body).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  }
  await prisma.productSize.deleteMany({ where: { productId: p.id } }); await prisma.product.delete({ where: { id: p.id } });
  expect((await adjust(p.id, 2, 0, key).expect(200)).body).toEqual(first.body);
});
test('same key different admins have independent scope, but shared Product OCC', async () => {
  const p = await product(), other = await actor('ADMIN'), key = randomUUID();
  await adjust(p.id, 1, 0, key).expect(200); await adjust(p.id, 2, 1, key, other).expect(200);
  expect(await row(p.id)).toMatchObject({ stock: 13, version: 2 });
});
test('concurrent same-key requests apply delta once and recover with the original request', async () => {
  const p = await product(), key = randomUUID(); const responses = await Promise.all([adjust(p.id, 3, 0, key), adjust(p.id, 3, 0, key)]);
  expect(responses.some(r => r.status === 200)).toBe(true); expect(responses.every(r => [200, 409].includes(r.status))).toBe(true);
  const replay = await adjust(p.id, 3, 0, key).expect(200); expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(await row(p.id)).toMatchObject({ stock: 13, version: 1 }); expect(await prisma.idempotencyRequest.count({ where: { userId: admin.id, operation: 'ADJUST_INVENTORY', idempotencyKey: key } })).toBe(1);
});
test('two concurrent admin adjustments using one Product version cannot both commit', async () => {
  const p = await product(), other = await actor('ADMIN'); const responses = await Promise.all([adjust(p.id, 2), adjust(p.id, 3, 0, randomUUID(), other)]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]); expect(await row(p.id)).toMatchObject({ stock: (responses[0].status === 200 ? 12 : 13), version: 1 });
});
test('trigger fault after Product change rolls back stock/version/claim/result and preserves business history', async () => {
  const p = await product(), before = await row(p.id), count = await prisma.idempotencyRequest.count(), records = await history();
  await client.query("CREATE FUNCTION a06_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='ADJUST_INVENTORY' AND NEW.state='COMPLETED' THEN RAISE EXCEPTION 'controlled private fault'; END IF; RETURN NEW; END $$");
  await client.query('CREATE TRIGGER a06_fault AFTER UPDATE ON idempotency_requests FOR EACH ROW EXECUTE FUNCTION a06_fault()');
  try { const r = await adjust(p.id, 1).expect(503); expect(r.text).not.toMatch(/controlled|Prisma|SQL|password_hash/); expect(await row(p.id)).toEqual(before); expect(await prisma.idempotencyRequest.count()).toBe(count); expect(await history()).toEqual(records); }
  finally { await client.query('DROP TRIGGER a06_fault ON idempotency_requests'); await client.query('DROP FUNCTION a06_fault()'); }
});
test('ADMIN-only endpoints enforce DB role before replay; forged claims and DB demotion', async () => {
  const p = await product(), key = randomUUID(); await adjust(p.id, 1, 0, key).expect(200);
  await api('get', '/admin/inventory').expect(401); await api('post', `/admin/products/${p.id}/inventory-adjustments`, undefined, { delta: 1, expectedVersion: 0 }).set('Idempotency-Key', key).expect(401);
  for (const who of [staff, customer]) {
    const forged = { ...who, token: jwt.sign({ sub: who.id, role: 'ADMIN' }) };
    await api('get', '/admin/inventory', forged).expect(403); await adjust(p.id, 1, 0, key, forged).expect(403);
  }
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'STAFF' } });
  try { await api('get', '/admin/inventory', admin).expect(403); await adjust(p.id, 1, 0, key).expect(403); }
  finally { await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } }); }
  expect(await row(p.id)).toMatchObject({ stock: 11, version: 1 });
});
test('availability requires active Product and active size after topup; no auto repair', async () => {
  for (const [active, sizes, expected] of [[true, ['M'], true], [false, ['M'], false], [true, [], false]] as [boolean, string[], boolean][]) {
    const p = await product(0, active, sizes); await adjust(p.id, 10).expect(200); const r = await api('get', `/products/${p.id}`);
    if (!active) expect(r.status).toBe(404); else expect(r.body).toMatchObject({ available: expected });
    expect(await row(p.id)).toMatchObject({ stock: 10, isActive: active }); expect(await prisma.productSize.count({ where: { productId: p.id } })).toBe(sizes.length);
  }
});
// Hold an actual inventory transaction after reading Product, commit the racing
// engine, then release the original CAS. These are simultaneous transactions.
async function race(id: string, version: number, competing: () => Promise<unknown>) {
  type Reader = { readProduct: (tx: Prisma.TransactionClient, id: string) => Promise<{ id: string; stock: number; version: number } | null> };
  const target = inventory as unknown as Reader; const original = target.readProduct.bind(inventory);
  let enter!: () => void, release!: () => void; const reached = new Promise<void>(r => { enter = r; }), resumed = new Promise<void>(r => { release = r; });
  const spy = jest.spyOn(target, 'readProduct').mockImplementation(async (tx, productId) => { const p = await original(tx, productId); enter(); await resumed; return p; });
  try {
    const adjusting = adjust(id, 2, version).then(r => r); await reached; await competing(); release();
    const r = await adjusting; expect(r.status).toBe(409); expect(r.body).toMatchObject({ error: { code: 'CONCURRENT_UPDATE' } });
  } finally { release(); spy.mockRestore(); }
}
test('Order creation racing adjustment preserves PENDING snapshot and single stock claim', async () => {
  const p = await product(), who = await actor(), item = { productId: p.id, size: 'M', qty: 1, toppingIds: [] };
  await api('post', '/cart/items', who, item).expect(201);
  await race(p.id, 0, async () => { await api('post', '/orders', who, { items: [item] }).set('Idempotency-Key', randomUUID()).expect(201); });
  expect(await row(p.id)).toMatchObject({ stock: 9, version: 1 }); expect(await prisma.order.count({ where: { userId: who.id } })).toBe(1);
});
test.each(['failure', 'retry', 'cancel'] as const)('Payment/B16 %s racing adjustment retains engine atomicity', async operation => {
  const f = await checkout(operation === 'retry' ? 'FAILED' : operation === 'cancel' ? 'PAID' : 'PENDING');
  const snapshot = await prisma.orderItem.findMany({ where: { orderId: f.id } });
  await race(f.p.id, f.p.version, async () => {
    if (operation === 'cancel') { const o = await prisma.order.findUniqueOrThrow({ where: { id: f.id } }); await api('post', `/admin/orders/${f.id}/paid-cancel`, admin, { expectedVersion: o.version }).expect(200); }
    else { mode = operation === 'failure' ? 'FAILURE' : 'SUCCESS'; await api('post', '/payments', f.who, { orderId: f.id, method: 'WALLET' }).set('Idempotency-Key', randomUUID()).expect(200); }
  });
  expect(await row(f.p.id)).toMatchObject({ stock: operation === 'retry' ? 9 : 10, version: f.p.version + 1 });
  expect(await prisma.orderItem.findMany({ where: { orderId: f.id } })).toEqual(snapshot);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.id } })).status).toBe(operation === 'failure' ? 'PAYMENT_FAILED' : operation === 'retry' ? 'PAID' : 'CANCELLED');
});
test.each(['metadata', 'size', 'association'] as const)('A04/A05 %s racing adjustment respects shared version', async operation => {
  const p = await product(); const t = await prisma.topping.create({ data: { name: 'Fixture cream', price: '0' } });
  await race(p.id, 0, async () => {
    if (operation === 'metadata') await api('patch', `/admin/products/${p.id}`, admin, { expectedVersion: 0, name: 'New fixture' }).expect(200);
    else if (operation === 'size') await api('patch', `/admin/products/${p.id}/sizes/M`, admin, { expectedVersion: 0, extraPrice: '1000' }).expect(200);
    else await api('post', `/admin/products/${p.id}/toppings`, admin, { expectedVersion: 0, toppingId: t.id }).expect(201);
  });
  expect(await row(p.id)).toMatchObject({ stock: 10, version: 1 });
});

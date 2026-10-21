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
import { PrismaClient, type UserRole } from '../../src/generated/prisma/client';
import { PricingService } from '../../src/pricing/pricing.service';
import { OrderService } from '../../src/orders/order.service';
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { configureApp } from '../../src/common/configure-app';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local test database required');
const url = new URL(connectionString); if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test required');
const schema = `brewlite_a05_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString, `-c search_path=${schema}`) }, { schema }) });
type Actor = { id: string; token: string };
let app: NestExpressApplication; let jwt: JwtService; let admin: Actor; let staff: Actor; let customer: Actor; let mode = 'SUCCESS';
const legacy = { product: randomUUID(), topping: randomUUID(), user: randomUUID(), cart: randomUUID(), item: randomUUID(), order: randomUUID(), claim: randomUUID() };
let migrationBefore: Record<string, unknown>; let migrationAfter: Record<string, unknown>; let constraintsBefore: unknown; let constraintsAfter: unknown;
async function fingerprint(legacyColumns = false) {
  const result: Record<string, unknown> = {};
  const tables = (await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [schema])).rows;
  for (const { table_name: table } of tables) {
    const projection = legacyColumns && table === 'toppings' ? "to_jsonb(t)-'is_active'-'version'" : legacyColumns && table === 'product_sizes' ? "to_jsonb(t)-'is_active'" : 'to_jsonb(t)';
    result[table] = (await client.query(`SELECT ${projection} AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object, actor?: Actor) => {
  const call = request(app.getHttpServer())[method](path); if (actor) call.set('Authorization', `Bearer ${actor.token}`); return body ? call.send(body) : call;
};
const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) => api(method, path, body, admin);
async function actor(role: UserRole = 'CUSTOMER'): Promise<Actor> { const row = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only', role } }); return { id: row.id, token: jwt.sign({ sub: row.id }) }; }
async function product(sizes = ['S', 'M']) {
  return prisma.product.create({ data: { name: 'Option fixture', price: '50000', imageUrl: '/images/cappuccino.svg', stock: 30, sizes: { create: sizes.map(size => ({ size, extraPrice: '0' })) } } });
}
async function topping() { return prisma.topping.create({ data: { name: 'Cream fixture', price: '5000' } }); }
async function checkout(failed = false) {
  const p = await product(); const t = await topping(); await prisma.productTopping.create({ data: { productId: p.id, toppingId: t.id } }); const who = await actor();
  const item = { productId: p.id, size: 'M', toppingIds: [t.id], qty: 1 };
  await api('post', '/cart/items', item, who).expect(201);
  const r = await api('post', '/orders', { items: [item] }, who).set('Idempotency-Key', randomUUID()).expect(201); const id = (r.body as { id: string }).id;
  if (failed) { mode = 'FAILURE'; await api('post', '/payments', { orderId: id, method: 'WALLET' }, who).set('Idempotency-Key', randomUUID()).expect(200); mode = 'SUCCESS'; }
  return { p: await prisma.product.findUniqueOrThrow({ where: { id: p.id } }), t, who, item, id };
}
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n) && n < '20261013160000_option_lifecycle').sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  await client.query("INSERT INTO users(id,email,password_hash,loyalty_points) VALUES($1,$2,'fixture',5)", [legacy.user, `${legacy.user}@example.invalid`]);
  await client.query("INSERT INTO products(id,name,price,image_url,stock,version) VALUES($1,'Legacy',50000,'/images/legacy.svg',9,7)", [legacy.product]);
  await client.query("INSERT INTO product_sizes(product_id,size,extra_price) VALUES($1,'M',0)", [legacy.product]);
  await client.query("INSERT INTO toppings(id,name,price) VALUES($1,'Legacy cream',5000)", [legacy.topping]);
  await client.query('INSERT INTO product_toppings(product_id,topping_id) VALUES($1,$2)', [legacy.product, legacy.topping]);
  await client.query('INSERT INTO carts(id,user_id) VALUES($1,$2)', [legacy.cart, legacy.user]);
  await client.query("INSERT INTO cart_items(id,cart_id,product_id,size,configuration_key,qty) VALUES($1,$2,$3,'M',$4,1)", [legacy.item, legacy.cart, legacy.product, `${legacy.product}:M:${legacy.topping}`]);
  await client.query('INSERT INTO cart_item_toppings(cart_item_id,topping_id) VALUES($1,$2)', [legacy.item, legacy.topping]);
  await client.query("INSERT INTO orders(id,order_code,user_id,status,subtotal,total,paid_at) VALUES($1,$2,$3,'PAID',55000,55000,now())", [legacy.order, `BL-${legacy.order}`, legacy.user]);
  const orderItem = randomUUID(); await client.query("INSERT INTO order_items(id,order_id,product_id,product_name_snapshot,size,base_price,size_extra_price,unit_price,qty,line_total) VALUES($1,$2,$3,'Legacy','M',50000,0,55000,1,55000)", [orderItem, legacy.order, legacy.product]);
  await client.query("INSERT INTO order_item_toppings(order_item_id,topping_id,topping_name_snapshot,price_snapshot) VALUES($1,$2,'Legacy cream',5000)", [orderItem, legacy.topping]);
  await client.query("INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state,order_id,response_status,response_body,completed_at) VALUES($1,$2,'PAY_ORDER','legacy','legacy','COMPLETED',$3,200,'{}',now())", [legacy.claim, legacy.user, legacy.order]);
  await client.query("INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status) VALUES($1,$2,$3,$4,'legacy',55000,'WALLET','SUCCEEDED')", [randomUUID(), legacy.order, legacy.user, legacy.claim]);
  await client.query('INSERT INTO loyalty_awards(id,order_id,user_id,points) VALUES($1,$2,$3,5)', [randomUUID(), legacy.order, legacy.user]);
  migrationBefore = await fingerprint(true); constraintsBefore = (await client.query("SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace=$1::regnamespace AND contype='f' ORDER BY conname", [schema])).rows;
  await client.query(readFileSync(resolve(dir, '20261013160000_option_lifecycle/migration.sql'), 'utf8'));
  migrationAfter = await fingerprint(true); constraintsAfter = (await client.query("SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace=$1::regnamespace AND contype='f' ORDER BY conname", [schema])).rows;
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n) && n > '20261013160000_option_lifecycle').sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(MockPaymentService).useValue({ result: () => mode }).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService); admin = await actor('ADMIN'); staff = await actor('STAFF'); customer = await actor();
});
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
beforeEach(() => { mode = 'SUCCESS'; });
test('AD02/D41 migration preserves every old row/column/history/FK and defaults active/version0', async () => {
  expect(migrationAfter).toEqual(migrationBefore); expect(constraintsAfter).toEqual(constraintsBefore);
  expect(await prisma.productSize.findUniqueOrThrow({ where: { productId_size: { productId: legacy.product, size: 'M' } } })).toMatchObject({ isActive: true });
  expect(await prisma.topping.findUniqueOrThrow({ where: { id: legacy.topping } })).toMatchObject({ isActive: true, version: 0 });
  await expect(client.query('UPDATE toppings SET version=-1 WHERE id=$1', [legacy.topping])).rejects.toMatchObject({ code: '23514' });
  expect((await topping()).version).toBe(0);
});
test('Cold Brew fixture becomes available only after explicit active size; price/stock preserved', async () => {
  const p = await product([]); const before = { price: p.price, stock: p.stock };
  expect((await api('get', `/products/${p.id}`).expect(200)).body).toMatchObject({ available: false, sizes: [] });
  const r = await call('post', `/admin/products/${p.id}/sizes`, { expectedVersion: 0, size: 'M', extraPrice: '5000' }).expect(201);
  expect(r.body).toMatchObject({ item: { productId: p.id, size: 'M', isActive: true, extraPrice: '5000' }, productVersion: 1 });
  expect(await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject(before);
  expect((await api('get', `/products/${p.id}`).expect(200)).body).toMatchObject({ available: true, price: '50000' });
  await call('post', `/admin/products/${p.id}/sizes`, { expectedVersion: 1, size: 'M', extraPrice: '0' }).expect(409);
  await call('post', `/admin/products/${p.id}/sizes`, { expectedVersion: 1, size: 'XL', extraPrice: '0' }).expect(400);
});
test('parent OCC and exact extraPrice update use current DB price for new checkout', async () => {
  const p = await product(); const who = await actor(); const item = { productId: p.id, size: 'M', toppingIds: [], qty: 1 };
  await api('post', '/cart/items', item, who).expect(201);
  await call('patch', `/admin/products/${p.id}/sizes/M`, { expectedVersion: 0, extraPrice: '7000' }).expect(200);
  await call('patch', `/admin/products/${p.id}/sizes/M`, { expectedVersion: 0, extraPrice: '1' }).expect(409);
  const order = await api('post', '/orders', { items: [item] }, who).set('Idempotency-Key', randomUUID()).expect(201); expect(order.body).toMatchObject({ total: '57000' });
});
test('inactive size preserves Cart/select state and rejects add/PATCH/new Order; last active guard', async () => {
  const p = await product(); const who = await actor(); const item = { productId: p.id, size: 'M', toppingIds: [], qty: 1 };
  const cart = await api('post', '/cart/items', item, who).expect(201); const stored = await prisma.cartItem.findMany({ where: { cart: { userId: who.id } } });
  await call('patch', `/admin/products/${p.id}/sizes/M`, { expectedVersion: 0, isActive: false }).expect(200);
  expect(await prisma.cartItem.findMany({ where: { cart: { userId: who.id } } })).toEqual(stored);
  expect((await api('get', '/cart', undefined, who).expect(200)).body).toMatchObject({ items: [{ available: false, size: 'M' }] });
  expect((await api('get', `/products/${p.id}`).expect(200)).body).toMatchObject({ sizes: [{ size: 'S' }] });
  await api('post', '/cart/items', item, who).expect(400); await api('patch', `/cart/items/${(cart.body as { items: { id: string }[] }).items[0].id}`, { qty: 2 }, who).expect(400);
  await api('post', '/orders', { items: [item] }, who).set('Idempotency-Key', randomUUID()).expect(400);
  await call('patch', `/admin/products/${p.id}/sizes/S`, { expectedVersion: 1, isActive: false }).expect(409);
  await call('patch', `/admin/products/${p.id}`, { expectedVersion: 1, isActive: false }).expect(200);
  await call('patch', `/admin/products/${p.id}/sizes/S`, { expectedVersion: 2, isActive: false }).expect(200);
  await call('patch', `/admin/products/${p.id}`, { expectedVersion: 3, isActive: true }).expect(409);
  await api('delete', `/cart/items/${stored[0].id}`, undefined, who).expect(200);
});
test('global topping CRUD/OCC/lifecycle and membership affect new purchases only', async () => {
  const p = await product(); const r = await call('post', '/admin/toppings', { name: ' Fresh cream ', price: '9000' }).expect(201); const t = r.body as { id: string; version: number };
  expect(r.body).toMatchObject({ name: 'Fresh cream', price: '9000', version: 0, isActive: true });
  const who = await actor(); const item = { productId: p.id, size: 'M', toppingIds: [t.id], qty: 1 };
  await api('post', '/cart/items', item, who).expect(400);
  await call('post', `/admin/products/${p.id}/toppings`, { expectedVersion: 0, toppingId: t.id }).expect(201);
  await call('post', `/admin/products/${p.id}/toppings`, { expectedVersion: 1, toppingId: t.id }).expect(409);
  await api('post', '/cart/items', item, who).expect(201); const stored = await prisma.cartItem.findMany({ where: { cart: { userId: who.id } }, include: { toppings: true } });
  await call('patch', `/admin/toppings/${t.id}`, { expectedVersion: 0, price: '10000', isActive: false }).expect(200);
  expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).version).toBe(1);
  expect((await api('get', `/products/${p.id}`).expect(200)).body).toMatchObject({ toppings: [] });
  expect((await api('get', '/cart', undefined, who).expect(200)).body).toMatchObject({ items: [{ available: false, toppings: [{ id: t.id }] }] });
  await api('post', '/orders', { items: [item] }, who).set('Idempotency-Key', randomUUID()).expect(400);
  expect(await prisma.cartItem.findMany({ where: { cart: { userId: who.id } }, include: { toppings: true } })).toEqual(stored);
  await call('patch', `/admin/toppings/${t.id}`, { expectedVersion: 1, isActive: true }).expect(200);
  expect((await api('post', '/orders', { items: [item] }, who).set('Idempotency-Key', randomUUID()).expect(201)).body).toMatchObject({ total: '60000' });
});
test('safe delete rejects Cart/history/association references, last size, stale and missing separately', async () => {
  await call('delete', `/admin/products/${legacy.product}/sizes/M`, { expectedVersion: 7 }).expect(409);
  await call('delete', `/admin/products/${legacy.product}/toppings/${legacy.topping}`, { expectedVersion: 7 }).expect(409);
  await call('delete', `/admin/toppings/${legacy.topping}`, { expectedVersion: 0 }).expect(409);
  const t = await topping(); await call('patch', `/admin/toppings/${t.id}`, { expectedVersion: 0, price: '0' }).expect(200);
  await call('delete', `/admin/toppings/${t.id}`, { expectedVersion: 0 }).expect(409); await call('delete', `/admin/toppings/${t.id}`, { expectedVersion: 1 }).expect(204);
  await call('delete', `/admin/toppings/${t.id}`, { expectedVersion: 1 }).expect(404);
  const p = await product(); const free = await topping();
  await call('post', `/admin/products/${p.id}/toppings`, { expectedVersion: 0, toppingId: free.id }).expect(201);
  await call('delete', `/admin/products/${p.id}/toppings/${free.id}`, { expectedVersion: 1 }).expect(204);
  await call('delete', `/admin/toppings/${free.id}`, { expectedVersion: 0 }).expect(204);
  await call('delete', `/admin/products/${p.id}/sizes/M`, { expectedVersion: 2 }).expect(204);
});
test('real failed-payment snapshot/retry and B16 completion/cancellation invariants survive retired options', async () => {
  const f = await checkout(true); const before = await prisma.order.findUniqueOrThrow({ where: { id: f.id }, include: { items: { include: { toppings: true } }, payments: true } });
  await call('patch', `/admin/products/${f.p.id}/sizes/M`, { expectedVersion: f.p.version, extraPrice: '20000', isActive: false }).expect(200);
  await call('patch', `/admin/toppings/${f.t.id}`, { expectedVersion: 0, price: '90000', name: 'Retired', isActive: false }).expect(200);
  const retry = await api('post', '/payments', { orderId: f.id, method: 'WALLET' }, f.who).set('Idempotency-Key', randomUUID()).expect(200);
  expect(retry.body).toMatchObject({ payment: { amount: '55000', status: 'SUCCEEDED' } });
  expect((await prisma.order.findUniqueOrThrow({ where: { id: f.id }, include: { items: { include: { toppings: true } } } })).items).toEqual(before.items);
  const paid = await prisma.order.findUniqueOrThrow({ where: { id: f.id } }); const payment = await prisma.payment.findMany({ where: { orderId: f.id } });
  await call('post', `/admin/orders/${f.id}/paid-cancel`, { expectedVersion: paid.version }).expect(200);
  expect(await prisma.payment.findMany({ where: { orderId: f.id } })).toEqual(payment);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: f.who.id } })).loyaltyPoints).toBe(0);
  expect((await prisma.product.findUniqueOrThrow({ where: { id: f.p.id } })).stock).toBe(30);
  const second = await checkout(); await api('post', '/payments', { orderId: second.id, method: 'WALLET' }, second.who).set('Idempotency-Key', randomUUID()).expect(200);
  const balance = (await prisma.user.findUniqueOrThrow({ where: { id: second.who.id } })).loyaltyPoints;
  for (const target of ['PREPARING', 'READY', 'COMPLETED'] as const) { const row = await prisma.order.findUniqueOrThrow({ where: { id: second.id } }); await app.get(OrderService).transitionOrder(row.id, row.version, target); }
  expect((await prisma.user.findUniqueOrThrow({ where: { id: second.who.id } })).loyaltyPoints).toBe(balance);
});
test('concurrent Topping PATCH same version has one winner and exactly one increment', async () => {
  const t = await topping(); const responses = await Promise.all(['6000', '7000'].map(price => call('patch', `/admin/toppings/${t.id}`, { expectedVersion: 0, price })));
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]); expect((await prisma.topping.findUniqueOrThrow({ where: { id: t.id } })).version).toBe(1);
});
test('concurrent Topping PATCH/DELETE cannot bypass OCC or overwrite missing resource', async () => {
  const t = await topping(); const [edit, remove] = await Promise.all([call('patch', `/admin/toppings/${t.id}`, { expectedVersion: 0, price: '7000' }), call('delete', `/admin/toppings/${t.id}`, { expectedVersion: 0 })]);
  expect([[200, 409], [404, 204], [409, 204]]).toContainEqual([edit.status, remove.status]);
  const row = await prisma.topping.findUnique({ where: { id: t.id } }); if (row) { expect(row.version).toBe(1); expect(row.price.toFixed(0)).toBe('7000'); }
});
test('concurrent Size edit and association update share parent OCC and stock remains unchanged', async () => {
  const p = await product(); const t = await topping();
  const responses = await Promise.all([call('patch', `/admin/products/${p.id}/sizes/M`, { expectedVersion: 0, extraPrice: '7000' }), call('post', `/admin/products/${p.id}/toppings`, { expectedVersion: 0, toppingId: t.id })]);
  expect([[200, 409], [201, 409]]).toContainEqual(responses.map(r => r.status).sort());
  const size = await prisma.productSize.findUniqueOrThrow({ where: { productId_size: { productId: p.id, size: 'M' } } });
  expect(size.extraPrice.toFixed(0)).toBe(responses[0].status === 200 ? '7000' : '0');
  expect(await prisma.productTopping.count({ where: { productId: p.id } })).toBe(responses[1].status === 201 ? 1 : 0);
  expect(await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ stock: 30, version: 1 });
});
test('rollback after Topping/size write preserves all rows, versions and timestamps', async () => {
  const p = await product(); const t = await topping();
  await client.query("CREATE FUNCTION a05_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled A05 fault'; END $$");
  try {
    await client.query('CREATE TRIGGER a05_top_fault AFTER UPDATE ON toppings FOR EACH ROW EXECUTE FUNCTION a05_fault()');
    const before = await fingerprint(); await call('patch', `/admin/toppings/${t.id}`, { expectedVersion: 0, price: '9000' }).expect(503); expect(await fingerprint()).toEqual(before);
    await client.query('DROP TRIGGER a05_top_fault ON toppings'); await client.query('CREATE TRIGGER a05_size_fault AFTER UPDATE ON product_sizes FOR EACH ROW EXECUTE FUNCTION a05_fault()');
    const sizeBefore = await fingerprint(); await call('patch', `/admin/products/${p.id}/sizes/M`, { expectedVersion: 0, extraPrice: '9000' }).expect(503); expect(await fingerprint()).toEqual(sizeBefore);
    await client.query('DROP TRIGGER a05_size_fault ON product_sizes');
  } finally { await client.query('DROP FUNCTION a05_fault() CASCADE'); }
});
test('actual Pricing barrier detects parent configuration update between read and stock CAS', async () => {
  const p = await product(); const who = await actor(); const item = { productId: p.id, size: 'M', toppingIds: [], qty: 1 }; await api('post', '/cart/items', item, who).expect(201);
  const pricing = app.get(PricingService); const original = pricing.validateCart.bind(pricing); let entered!: () => void; let release!: () => void;
  const reached = new Promise<void>(r => { entered = r; }); const resumed = new Promise<void>(r => { release = r; });
  const spy = jest.spyOn(pricing, 'validateCart').mockImplementation(async (...args) => { const result = await original(...args); entered(); await resumed; return result; });
  try {
    const placing = api('post', '/orders', { items: [item] }, who).set('Idempotency-Key', randomUUID()).then(r => r);
    await reached; await call('patch', `/admin/products/${p.id}/sizes/M`, { expectedVersion: 0, extraPrice: '9000' }).expect(200); release(); expect((await placing).status).toBe(409);
    expect(await prisma.order.count({ where: { userId: who.id } })).toBe(0); expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(30);
  } finally { release(); spy.mockRestore(); }
});
test('global Topping price edit concurrent with checkout preserves B09 read-time authoritative snapshot', async () => {
  const p = await product(); const t = await topping(); await prisma.productTopping.create({ data: { productId: p.id, toppingId: t.id } });
  const who = await actor(); const item = { productId: p.id, size: 'M', toppingIds: [t.id], qty: 1 }; await api('post', '/cart/items', item, who).expect(201);
  const pricing = app.get(PricingService); const original = pricing.validateCart.bind(pricing); let entered!: () => void; let release!: () => void;
  const reached = new Promise<void>(r => { entered = r; }); const resumed = new Promise<void>(r => { release = r; });
  const spy = jest.spyOn(pricing, 'validateCart').mockImplementation(async (...args) => { const result = await original(...args); entered(); await resumed; return result; });
  try {
    const placing = api('post', '/orders', { items: [item] }, who).set('Idempotency-Key', randomUUID()).then(r => r);
    await reached; await call('patch', `/admin/toppings/${t.id}`, { expectedVersion: 0, price: '9000' }).expect(200); release();
    const response = await placing; expect(response.status).toBe(201); expect(response.body as unknown).toMatchObject({ total: '55000', items: [{ toppings: [{ price: '5000' }] }] });
    expect((await prisma.topping.findUniqueOrThrow({ where: { id: t.id } })).price.toFixed(0)).toBe('9000');
  } finally { release(); spy.mockRestore(); }
});
test('association detachment versus Cart selection cannot both commit an invalid persistent selection', async () => {
  const p = await product(); const t = await topping(); await prisma.productTopping.create({ data: { productId: p.id, toppingId: t.id } }); const who = await actor();
  const [select, detach] = await Promise.all([api('post', '/cart/items', { productId: p.id, size: 'M', toppingIds: [t.id], qty: 1 }, who), call('delete', `/admin/products/${p.id}/toppings/${t.id}`, { expectedVersion: 0 })]);
  expect([[201, 409], [400, 204]]).toContainEqual([select.status, detach.status]);
  expect(await prisma.cartItem.count({ where: { productId: p.id } })).toBe(select.status === 201 ? 1 : 0);
  expect(await prisma.productTopping.count({ where: { productId: p.id, toppingId: t.id } })).toBe(select.status === 201 ? 1 : 0);
});
test('association parent-write failure rolls back child relationship and revision', async () => {
  const p = await product(); const t = await topping(); const before = await fingerprint();
  await client.query("CREATE FUNCTION a05_parent_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled parent fault'; END $$");
  await client.query('CREATE TRIGGER a05_parent_fault AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION a05_parent_fault()');
  try { await call('post', `/admin/products/${p.id}/toppings`, { expectedVersion: 0, toppingId: t.id }).expect(503); expect(await fingerprint()).toEqual(before); }
  finally { await client.query('DROP TRIGGER a05_parent_fault ON products'); await client.query('DROP FUNCTION a05_parent_fault()'); }
});
test('missing resources and invalid/empty mutation DTOs are explicit and read-only', async () => {
  const p = await product(); const t = await topping(); const before = await fingerprint();
  await call('patch', `/admin/products/${p.id}/sizes/L`, { expectedVersion: 0, extraPrice: '0' }).expect(404);
  await call('get', `/admin/products/${randomUUID()}/sizes`).expect(404); await call('get', `/admin/toppings/${randomUUID()}`).expect(404);
  await call('patch', `/admin/toppings/${t.id}`, { expectedVersion: 0 }).expect(400); await call('patch', `/admin/products/${p.id}/sizes/M`, { expectedVersion: 0 }).expect(400);
  for (const extra of [{ stock: 1 }, { version: 1 }, { role: 'ADMIN' }]) await call('patch', `/admin/toppings/${t.id}`, { expectedVersion: 0, price: '0', ...extra }).expect(400);
  expect(await fingerprint()).toEqual(before);
});
test('real database read fault returns sanitized503; GET leaves data unchanged after recovery', async () => {
  const before = await fingerprint(); await client.query('ALTER TABLE toppings RENAME TO toppings_a05_fault');
  try { const response = await call('get', '/admin/toppings').expect(503); expect(response.text).not.toMatch(/Prisma|SQL|schema|password|toppings_a05_fault/); }
  finally { await client.query('ALTER TABLE toppings_a05_fault RENAME TO toppings'); }
  expect(await fingerprint()).toEqual(before);
});
test('all management GETs and denied mutations remain read-only; DB role and forged claims enforced', async () => {
  const before = await fingerprint();
  for (const path of ['/admin/toppings', `/admin/toppings/${legacy.topping}`, `/admin/products/${legacy.product}/sizes`, `/admin/products/${legacy.product}/toppings`]) {
    await call('get', path).expect(200); await api('get', path).expect(401);
    for (const who of [staff, customer]) await api('get', path, undefined, { ...who, token: jwt.sign({ sub: who.id, role: 'ADMIN' }) }).expect(403);
  }
  for (const who of [staff, customer]) for (const path of ['/admin/toppings', `/admin/products/${legacy.product}/sizes`, `/admin/products/${legacy.product}/toppings`]) await api('post', path, { expectedVersion: 7, role: 'ADMIN' }, who).expect(403);
  expect(await fingerprint()).toEqual(before);
  await prisma.user.update({ where: { id: admin.id }, data: { role: 'STAFF' } }); try { await call('patch', `/admin/toppings/${legacy.topping}`, { expectedVersion: 0, price: '0' }).expect(403); }
  finally { await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } }); }
});

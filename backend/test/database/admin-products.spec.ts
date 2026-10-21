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
import { AdminProductService } from '../../src/catalog/admin-product.service';
import { PricingService } from '../../src/pricing/pricing.service';
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { configureApp } from '../../src/common/configure-app';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local test database required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test required');
const schema = `brewlite_a04_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString, `-c search_path=${schema}`) }, { schema }) });
let app: NestExpressApplication; let jwt: JwtService; let admin: Actor; let mode: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
type Actor = { id: string; token: string };
const legacy = randomUUID(); const top = randomUUID(); let migrationBefore: unknown; let fkBefore: unknown; let migrationAfter: Record<string, unknown>; let fkAfter: unknown; let flagsAfter: unknown;
async function actor(role: UserRole = 'CUSTOMER'): Promise<Actor> { const u = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only', role } }); return { id: u.id, token: jwt.sign({ sub: u.id }) }; }
const get = (who: Actor, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${who.token}`);
const createInput = (name = 'Fixture') => ({ name, price: '45000', imageUrl: '/images/cappuccino.svg', sizes: [{ size: 'S', extraPrice: '0' }, { size: 'M', extraPrice: '5000' }], toppingIds: [top] });
const post = (who: Actor, path: string, body: object) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${who.token}`).send(body);
const patch = (id: string, expectedVersion: number, fields: object) => request(app.getHttpServer()).patch(`/admin/products/${id}`).set('Authorization', `Bearer ${admin.token}`).send({ expectedVersion, ...fields });
const del = (id: string, expectedVersion: number) => request(app.getHttpServer()).delete(`/admin/products/${id}`).set('Authorization', `Bearer ${admin.token}`).send({ expectedVersion });
async function fingerprints() {
  const result: Record<string, unknown> = {};
  const tables = (await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [schema])).rows;
  for (const { table_name: table } of tables) result[table] = (await client.query(`SELECT to_jsonb(t)-'is_active' AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
}
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n) && n < '20261013090000_product_lifecycle').sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  await client.query("INSERT INTO products(id,name,price,image_url,stock,version) VALUES($1,'Cold brew legacy',50000,'/images/cold.svg',1,7)", [legacy]);
  await client.query("INSERT INTO toppings(id,name,price) VALUES($1,'Cream',5000)", [top]);
  const user = randomUUID(); const product = randomUUID(); const cart = randomUUID(); const item = randomUUID(); const order = randomUUID(); const claim = randomUUID();
  await client.query("INSERT INTO users(id,email,password_hash,loyalty_points) VALUES($1,$2,'fixture',5)", [user, `${user}@example.invalid`]);
  await client.query("INSERT INTO products(id,name,price,image_url,stock) VALUES($1,'History',50000,'/images/history.svg',9)", [product]);
  await client.query("INSERT INTO product_sizes VALUES($1,'M',0)", [product]); await client.query('INSERT INTO product_toppings VALUES($1,$2)', [product, top]);
  await client.query('INSERT INTO carts(id,user_id) VALUES($1,$2)', [cart, user]);
  await client.query("INSERT INTO cart_items(id,cart_id,product_id,size,configuration_key,qty) VALUES($1,$2,$3,'M',$4,1)", [item, cart, product, `${product}:M`]);
  await client.query("INSERT INTO orders(id,order_code,user_id,status,subtotal,total,paid_at) VALUES($1,$2,$3,'PAID',50000,50000,now())", [order, order, user]);
  await client.query("INSERT INTO order_items(id,order_id,product_id,product_name_snapshot,size,base_price,size_extra_price,unit_price,qty,line_total) VALUES($1,$2,$3,'History','M',50000,0,50000,1,50000)", [randomUUID(), order, product]);
  await client.query("INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state,order_id,response_status,response_body,completed_at) VALUES($1,$2,'PAY_ORDER','migration','migration','COMPLETED',$3,200,'{}',now())", [claim, user, order]);
  await client.query("INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status) VALUES($1,$2,$3,$4,'migration',50000,'WALLET','SUCCEEDED')", [randomUUID(), order, user, claim]);
  await client.query('INSERT INTO loyalty_awards(id,order_id,user_id,points) VALUES($1,$2,$3,5)', [randomUUID(), order, user]);
  migrationBefore = await fingerprints(); fkBefore = (await client.query("SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace=$1::regnamespace ORDER BY conname", [schema])).rows;
  await client.query(readFileSync(resolve(dir, '20261013090000_product_lifecycle/migration.sql'), 'utf8'));
  migrationAfter = await fingerprints();
  fkAfter = (await client.query("SELECT conname,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname<>'products_is_active_not_null' ORDER BY conname", [schema])).rows;
  flagsAfter = (await client.query("SELECT table_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND column_name='is_active' AND table_name IN ('products','product_sizes','toppings')", [schema])).rows;
  // Preserve the A04-only migration assertions, then apply subsequent migrations for current-source regression.
  for (const name of readdirSync(dir).filter(n => n > '20261013090000_product_lifecycle' && /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(MockPaymentService).useValue({ result: () => mode }).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService); admin = await actor('ADMIN');
});
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
beforeEach(() => { mode = 'SUCCESS'; });
async function product() {
  const r = await post(admin, '/admin/products', createInput()).expect(201); const id = (r.body as { id: string }).id;
  return prisma.product.findUniqueOrThrow({ where: { id } });
}
async function cartFixture() {
  const p = await product(); await prisma.product.update({ where: { id: p.id }, data: { stock: 20 } }); const who = await actor();
  const input = { productId: p.id, size: 'M', toppingIds: [top], qty: 1 };
  await post(who, '/cart/items', input).expect(201); return { p: await prisma.product.findUniqueOrThrow({ where: { id: p.id } }), who, input };
}
async function orderFixture(failed = false) {
  const f = await cartFixture(); const r = await post(f.who, '/orders', { items: [f.input] }).set('Idempotency-Key', randomUUID()).expect(201);
  const id = (r.body as { id: string }).id; if (failed) { mode = 'FAILURE'; await post(f.who, '/payments', { orderId: id, method: 'WALLET' }).set('Idempotency-Key', randomUUID()).expect(200); mode = 'SUCCESS'; }
  return { ...f, id };
}
test('migration default/backfill preserves all existing columns/history/FK and legacy unconfigured Product', async () => {
  expect(migrationAfter).toEqual(migrationBefore); expect(fkAfter).toEqual(fkBefore);
  expect(await prisma.product.findUniqueOrThrow({ where: { id: legacy } })).toMatchObject({ stock: 1, version: 7, isActive: true });
  expect(flagsAfter).toEqual([{ table_name: 'products', is_nullable: 'NO', column_default: 'true' }]);
});
test('Cold brew remains visible, detail unavailable, no size created, invalid new configuration rejected', async () => {
  const r = await request(app.getHttpServer()).get(`/products/${legacy}`).expect(200); expect(r.body).toMatchObject({ price: '50000', available: false, sizes: [] });
  expect(await prisma.productSize.count({ where: { productId: legacy } })).toBe(0); const who = await actor();
  await post(who, '/cart/items', { productId: legacy, size: 'M', toppingIds: [], qty: 1 }).expect(400);
  const list = (await request(app.getHttpServer()).get('/products').expect(200)).body as { items: { id: string; available: boolean }[] };
  expect(list.items.find(p => p.id === legacy)).toMatchObject({ available: false });
});
test('ADMIN create persists exact phased response, Decimal options and stock0/default active; no stock mutation body', async () => {
  const r = await post(admin, '/admin/products', { ...createInput(), price: '999999999999' }).expect(201);
  expect(Object.keys(r.body as object).sort()).toEqual(['id', 'name', 'price', 'imageUrl', 'stock', 'isActive', 'version', 'createdAt', 'updatedAt', 'sizes', 'toppings'].sort());
  expect(r.body).toMatchObject({ price: '999999999999', stock: 0, isActive: true, version: 0, sizes: [{ size: 'S', extraPrice: '0' }, { size: 'M', extraPrice: '5000' }] });
  expect(Object.keys((r.body as { toppings: object[] }).toppings[0]).sort()).toEqual(['id', 'name', 'price', 'createdAt', 'updatedAt'].sort());
  const id = (r.body as { id: string }).id; expect((await request(app.getHttpServer()).get(`/products/${id}`).expect(200)).body).toMatchObject({ available: false });
  await patch(id, 0, { stock: 30 }).expect(400);
});
test.each(['STAFF', 'CUSTOMER'] as const)('%s cannot create/update/delete or read management, forged claim ignored', async role => {
  const who = await actor(role); who.token = jwt.sign({ sub: who.id, role: 'ADMIN' });
  await post(who, '/admin/products', createInput()).expect(403); await get(who, '/admin/products').expect(403);
  for (const method of ['patch', 'delete'] as const) await request(app.getHttpServer())[method](`/admin/products/${legacy}`).set('Authorization', `Bearer ${who.token}`).send({ expectedVersion: 7, name: 'Injected' }).expect(403);
});
test('update current prices, deactivate/reactivate, Cart kept, new add/PATCH/checkout blocked, remove allowed', async () => {
  const f = await cartFixture(); const before = await prisma.cart.findUniqueOrThrow({ where: { userId: f.who.id }, include: { items: true } });
  await patch(f.p.id, 0, { name: 'Changed', price: '55001', isActive: false }).expect(200);
  expect(await prisma.product.findUniqueOrThrow({ where: { id: f.p.id } })).toMatchObject({ stock: 20, version: 1, isActive: false });
  await request(app.getHttpServer()).get(`/products/${f.p.id}`).expect(404);
  expect(((await request(app.getHttpServer()).get('/products').expect(200)).body as { items: { id: string }[] }).items.some(p => p.id === f.p.id)).toBe(false);
  expect(await prisma.cart.findUniqueOrThrow({ where: { userId: f.who.id }, include: { items: true } })).toEqual(before);
  expect((await get(f.who, '/cart').expect(200)).body).toMatchObject({ items: [expect.objectContaining({ available: false, unitPrice: '65001' })] });
  await post(f.who, '/cart/items', f.input).expect(409);
  await request(app.getHttpServer()).patch(`/cart/items/${before.items[0].id}`).set('Authorization', `Bearer ${f.who.token}`).send({ qty: 2 }).expect(409);
  const create = await post(f.who, '/orders', { items: [f.input] }).set('Idempotency-Key', randomUUID()).expect(409); expect(create.body).toMatchObject({ error: { code: 'PRODUCT_UNAVAILABLE' } });
  expect(await prisma.order.count({ where: { userId: f.who.id } })).toBe(0); expect(await prisma.idempotencyRequest.count({ where: { userId: f.who.id } })).toBe(0);
  await patch(f.p.id, 1, { isActive: true }).expect(200); expect((await request(app.getHttpServer()).get(`/products/${f.p.id}`).expect(200)).body).toMatchObject({ price: '55001', available: true });
  await request(app.getHttpServer()).delete(`/cart/items/${before.items[0].id}`).set('Authorization', `Bearer ${f.who.token}`).expect(200);
  await post(f.who, '/cart/items', f.input).expect(201); await patch(f.p.id, 2, { isActive: false }).expect(200);
  const current = await prisma.cartItem.findFirstOrThrow({ where: { cartId: before.id } }); await request(app.getHttpServer()).delete(`/cart/items/${current.id}`).set('Authorization', `Bearer ${f.who.token}`).expect(200);
});
test('new checkout snapshots authoritative changed price, old failed Payment retry ignores flag/price and preserves history', async () => {
  const f = await orderFixture(true); const saved = await prisma.order.findUniqueOrThrow({ where: { id: f.id }, include: { items: { include: { toppings: true } } } });
  const p = await prisma.product.findUniqueOrThrow({ where: { id: f.p.id } }); const payments = await prisma.payment.findMany({ where: { orderId: f.id } });
  await patch(p.id, p.version, { price: '90000', name: 'New', isActive: false }).expect(200);
  expect(await prisma.payment.findMany({ where: { orderId: f.id } })).toEqual(payments);
  expect(await prisma.order.findUniqueOrThrow({ where: { id: f.id }, include: { items: { include: { toppings: true } } } })).toEqual(saved);
  const r = await post(f.who, '/payments', { orderId: f.id, method: 'CARD' }).set('Idempotency-Key', randomUUID()).expect(200); expect(r.body).toMatchObject({ order: { status: 'PAID' } });
  expect((await prisma.payment.findFirstOrThrow({ where: { orderId: f.id, status: 'SUCCEEDED' } })).amount.toFixed(0)).toBe('55000');
  const newF = await cartFixture(); await patch(newF.p.id, 0, { price: '70001' }).expect(200);
  const newer = await post(newF.who, '/orders', { items: [newF.input] }).set('Idempotency-Key', randomUUID()).expect(201); expect(newer.body).toMatchObject({ total: '80001' });
});
test('safe delete removes child configuration atomically; stale/missing IDs and Cart/Order references reject', async () => {
  const p = await product(); await del(p.id, 1).expect(409); await del(p.id, 0).expect(204); await del(p.id, 0).expect(404);
  expect(await prisma.productSize.count({ where: { productId: p.id } })).toBe(0); expect(await prisma.productTopping.count({ where: { productId: p.id } })).toBe(0); expect(await prisma.topping.findUnique({ where: { id: top } })).not.toBeNull();
  const f = await cartFixture(); expect((await del(f.p.id, 0).expect(409)).body).toMatchObject({ error: { code: 'RESOURCE_IN_USE' } });
  const o = await orderFixture(); const current = await prisma.product.findUniqueOrThrow({ where: { id: o.p.id } }); await del(current.id, current.version).expect(409);
  expect(await prisma.productSize.count({ where: { productId: current.id } })).toBe(2);
});
test('empty patch/unknown topping/not found reject with no writes; duplicate POST has no idempotency guarantee', async () => {
  const p = await product(); await patch(p.id, 0, {}).expect(400); await patch(randomUUID(), 0, { name: 'Unknown' }).expect(404);
  await post(admin, '/admin/products', { ...createInput(), toppingIds: [randomUUID()] }).expect(404);
  const name = randomUUID(); await post(admin, '/admin/products', createInput(name)).expect(201); await post(admin, '/admin/products', createInput(name)).expect(201); expect(await prisma.product.count({ where: { name } })).toBe(2);
});
test('two updates with same expectedVersion commit exactly once, preserving stock and bump once', async () => {
  const p = await product(); const results = await Promise.all([patch(p.id, 0, { price: '1' }), patch(p.id, 0, { price: '2' })]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]); expect(await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ version: 1, stock: 0 });
});
test('stock CAS uses shared Product.version; stale metadata cannot overwrite stock', async () => {
  const f = await cartFixture(); await post(f.who, '/orders', { items: [f.input] }).set('Idempotency-Key', randomUUID()).expect(201);
  await patch(f.p.id, 0, { price: '1' }).expect(409); expect(await prisma.product.findUniqueOrThrow({ where: { id: f.p.id } })).toMatchObject({ stock: 19, price: f.p.price, version: 1 });
});
test('metadata/deactivation between Pricing read and Order stock CAS rejects stale version, no partial Order', async () => {
  const f = await cartFixture(); const pricing = app.get(PricingService); const original = pricing.validateCart.bind(pricing);
  let proceed!: () => void; let read!: () => void; const reached = new Promise<void>(r => { read = r; }); const gate = new Promise<void>(r => { proceed = r; });
  const spy = jest.spyOn(pricing, 'validateCart').mockImplementation(async (...args) => { const value = await original(...args); read(); await gate; return value; });
  try {
    const create = post(f.who, '/orders', { items: [f.input] }).set('Idempotency-Key', randomUUID()).then(r => r);
    await reached; await app.get(AdminProductService).update(f.p.id, { expectedVersion: 0, isActive: false }); proceed(); const result = await create;
    expect(result.status).toBe(409); expect(result.body).toMatchObject({ error: { code: 'CONCURRENT_UPDATE' } }); expect(await prisma.order.count({ where: { userId: f.who.id } })).toBe(0); expect(await prisma.idempotencyRequest.count({ where: { userId: f.who.id } })).toBe(0);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: f.p.id } })).toMatchObject({ stock: 20, version: 1, isActive: false });
  } finally { proceed(); spy.mockRestore(); }
});
test('delete-vs-Cart FK consumers serialize safely, no partial child configuration', async () => {
  const p = await product(); await prisma.product.update({ where: { id: p.id }, data: { stock: 10 } }); const who = await actor();
  const results = await Promise.all([post(who, '/cart/items', { productId: p.id, size: 'M', toppingIds: [top], qty: 1 }), del(p.id, 0)]);
  const row = await prisma.product.findUnique({ where: { id: p.id } });
  if (row) { expect(results.map(r => r.status)).toEqual([201, 409]); expect(await prisma.productSize.count({ where: { productId: p.id } })).toBe(2); }
  else { expect(results[1].status).toBe(204); expect(results[0].status).toBe(404); expect(await prisma.cartItem.count({ where: { productId: p.id } })).toBe(0); }
});
test('technical update/delete faults sanitize and rollback child config; overflow fails without stock/history mutation', async () => {
  const p = await product(); const before = await fingerprints();
  await client.query(`CREATE FUNCTION fail_a04() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private SQL password'; END; $$`);
  await client.query(`CREATE TRIGGER fail_a04 BEFORE DELETE ON products FOR EACH ROW EXECUTE FUNCTION fail_a04()`);
  try { const r = await del(p.id, 0).expect(503); expect(r.text).not.toMatch(/private SQL|password/); expect(await fingerprints()).toEqual(before); }
  finally { await client.query('DROP TRIGGER fail_a04 ON products; DROP FUNCTION fail_a04()'); }
  await prisma.product.update({ where: { id: p.id }, data: { version: 2147483647 } }); await patch(p.id, 2147483647, { price: '1' }).expect(503);
  expect(await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ stock: 0, price: p.price, version: 2147483647 });
});
test('real Product lock timeout is409; no retry or mutation', async () => {
  const p = await product(); const lock = new Client({ connectionString }); await lock.connect();
  try { await lock.query('BEGIN'); await lock.query(`SET search_path TO "${schema}"`); await lock.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [p.id]); await patch(p.id, 0, { name: 'Lock' }).expect(409); }
  finally { await lock.query('ROLLBACK'); await lock.end(); }
  expect(await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ name: p.name, version: 0 });
});
test('create failure after child write rolls back Product/sizes/association; sanitized503', async () => {
  const before = await fingerprints();
  await client.query(`CREATE FUNCTION fail_a04_child() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.size='M' THEN RAISE EXCEPTION 'private SQL password'; END IF; RETURN NEW; END; $$`);
  await client.query('CREATE TRIGGER fail_a04_child AFTER INSERT ON product_sizes FOR EACH ROW EXECUTE FUNCTION fail_a04_child()');
  try { const r = await post(admin, '/admin/products', createInput()).expect(503); expect(r.text).not.toMatch(/private SQL|password/); expect(await fingerprints()).toEqual(before); }
  finally { await client.query('DROP TRIGGER fail_a04_child ON product_sizes; DROP FUNCTION fail_a04_child()'); }
});
test('update failure after flag/price/version write rolls back all effects', async () => {
  const p = await product(); const before = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
  await client.query(`CREATE FUNCTION fail_a04_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private SQL'; END; $$`);
  await client.query('CREATE TRIGGER fail_a04_update AFTER UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fail_a04_update()');
  try { await patch(p.id, 0, { price: '1', isActive: false }).expect(503); expect(await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).toEqual(before); }
  finally { await client.query('DROP TRIGGER fail_a04_update ON products; DROP FUNCTION fail_a04_update()'); }
});
test('concurrent metadata update and Order creation preserve shared-version stock/pricing boundaries', async () => {
  const f = await cartFixture(); const results = await Promise.all([patch(f.p.id, 0, { price: '55000' }), post(f.who, '/orders', { items: [f.input] }).set('Idempotency-Key', randomUUID())]);
  const row = await prisma.product.findUniqueOrThrow({ where: { id: f.p.id } });
  expect([200, 409]).toContain(results[0].status); expect([201, 409]).toContain(results[1].status);
  const edited = results[0].status === 200; const created = results[1].status === 201;
  expect(edited || created).toBe(true); expect(row.version).toBe(Number(edited) + Number(created)); expect(row.stock).toBe(created ? 19 : 20); expect(row.price.toFixed(0)).toBe(edited ? '55000' : '45000');
  if (created) { const order = await prisma.order.findFirstOrThrow({ where: { userId: f.who.id }, include: { items: true } }); expect(order.total.toFixed(0)).toBe(edited ? '65000' : '55000'); expect(order.items[0].basePrice.toFixed(0)).toBe(edited ? '55000' : '45000'); }
  else { expect(await prisma.order.count({ where: { userId: f.who.id } })).toBe(0); expect(await prisma.idempotencyRequest.count({ where: { userId: f.who.id } })).toBe(0); }
});

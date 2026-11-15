import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../../src/app.module';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/database/prisma.service';
import { utcConnectionString } from '../../src/database/pg-connection';
import { configureApp } from '../../src/common/configure-app';
import { IngredientService } from '../../src/ingredients/ingredient.service';
import { CartService } from '../../src/cart/cart.service';
import { OrderService } from '../../src/orders/order.service';
import { IpnService } from '../../src/payments/ipn.service';
import { PaymentExpirationWorker } from '../../src/orders/payment-expiration.worker';
import { PaymentReceiptWorker } from '../../src/payments/payment-receipt.worker';
import { recipeAmountKey, inventoryRecipeForDrink as recipeForDrink, recipeStorageName, sumRecipeAmounts, type DrinkSize } from '../../src/catalog/drink-recipes';
import { signParameters } from '../../src/payments/vnpay/vnpay-signing';
import { SANDBOX_PAYMENT_URL } from '../../src/payments/vnpay/vnpay-config';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname) || !/_test$/.test(new URL(connectionString).pathname)) throw Error('Explicit local test database required');
describe.each(['uuid','text'])('size recipes with %s identity storage', storage => {
const schema = 'size_recipes_' + randomUUID().replaceAll('-', '');
const client = new Client({ connectionString });
const db = Object.assign(new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString, `-c search_path=${schema}`) }, { schema }) }), { transactionOptions: { maxWait: 2000, timeout: 5000 } });
const profile = { environment: 'SANDBOX', version: '2.1.0', merchantCode: 'TEST0001', hashSecret: 'synthetic-size-recipe-test-secret-only', paymentUrl: SANDBOX_PAYMENT_URL,
  returnUrl: 'https://callback.example.org/payments/vnpay/return', ipnUrl: 'https://callback.example.org/payments/vnpay/ipn' };
let app: NestExpressApplication, jwt: JwtService, admin: string, staff: string;
const auth = (id: string) => 'Bearer ' + jwt.sign({ sub: id });
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const directory = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(directory).filter(n => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(directory, name, 'migration.sql'), 'utf8'));
  if (storage === 'text') {
    const quote = (name: string) => '"' + name.replaceAll('"','""') + '"';
    const constraints = await client.query<{table:string;name:string;definition:string}>(`SELECT c.conrelid::regclass::text AS "table",c.conname AS name,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1 AND c.contype IN ('f','c')`,[schema]);
    for (const row of constraints.rows) await client.query(`ALTER TABLE ${row.table} DROP CONSTRAINT ${quote(row.name)}`);
    const columns = await client.query<{table_name:string;column_name:string}>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND udt_name='uuid'",[schema]);
    for (const column of columns.rows) await client.query(`ALTER TABLE ${quote(column.table_name)} ALTER COLUMN ${quote(column.column_name)} TYPE text USING ${quote(column.column_name)}::text`);
    for (const row of constraints.rows) await client.query(`ALTER TABLE ${row.table} ADD CONSTRAINT ${quote(row.name)} ${row.definition}`);
  }
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db)
    .overrideProvider(ConfigService).useValue(new ConfigService({ NODE_ENV: 'test', JWT_SECRET: 'synthetic-size-recipe-jwt-secret-at-least-32-bytes', JWT_EXPIRES_IN: 3600,
      PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_CONFIG: profile, VNPAY_ACCEPT_NEW_PAYMENTS: true }))
    .overrideProvider(PaymentExpirationWorker).useValue({}).overrideProvider(PaymentReceiptWorker).useValue({}).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  admin = (await db.user.create({ data: { id: storage === 'text' ? '12345' : randomUUID(), email: randomUUID()+'@example.invalid', passwordHash: 'isolated-fixture', role: 'ADMIN' } })).id;
  staff = (await db.user.create({ data: { id: storage === 'text' ? '12346' : randomUUID(), email: randomUUID()+'@example.invalid', passwordHash: 'isolated-fixture', role: 'STAFF' } })).id;
  await app.get(IngredientService).initializeCatalog(admin);
});
beforeEach(async () => {
  await db.ingredientReservation.updateMany({ where: { state: 'RESERVED' }, data: { state: 'RELEASED' } });
  await db.ingredient.updateMany({ data: { quantity: '1000', reservedQuantity: '0' } });
});
afterAll(async () => { if (app) await app.close(); await db.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
async function fixture(name = 'Latte', size: DrinkSize = 'S', qty = 1, price = '10000', toppings: string[] = []) {
  const user = (await db.user.create({ data: { email: randomUUID()+'@example.invalid', passwordHash: 'isolated-fixture' } })).id;
  const product = await db.product.create({ data: { name, stock: 0, price, imageUrl: '/images/latte.svg', sizes: { create: ['S','M','L'].map(size => ({ size, extraPrice: '0' })) } } });
  const toppingIds: string[] = [];
  for (const name of toppings) {
    const topping = await db.topping.create({ data: { name, price: '0', products: { create: { productId: product.id } } } });
    toppingIds.push(topping.id);
  }
  const input = { productId: product.id, size, qty, toppingIds };
  await app.get(CartService).add(user, input);
  return { user, product, input, key: randomUUID() };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = (f: Fixture) => request(app.getHttpServer()).post('/orders').set('Authorization', auth(f.user)).set('Idempotency-Key', f.key).send({ items: [f.input] });
const cancel = (f: Fixture, id: string) => request(app.getHttpServer()).post(`/orders/${id}/cancel`).set('Authorization', auth(f.user)).send({});
const zero = (f: Fixture, id: string, key = randomUUID()) => request(app.getHttpServer()).post(`/orders/${id}/confirm-zero`).set('Authorization', auth(f.user)).set('Idempotency-Key', key).send({});
const initiate = (f: Fixture, id: string, key = randomUUID()) => request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', auth(f.user)).set('Idempotency-Key', key).send({ orderId: id });
const stock = (name: string) => db.ingredient.findUniqueOrThrow({ where: { normalizedName: recipeStorageName(name).toLocaleLowerCase('vi') } });

for (const size of ['S','M','L'] as const) test.each(['Cappuccino','Latte','Cold brew','Đen đá','Asian Dolce Latte','Matcha Coldwisk','Cacao đá'])('%s size '+size+' freezes exact doses, reserves once and releases once', async name => {
  const f = await fixture(name, size, 2);
  const made = await create(f).expect(201), id = (made.body as { id: string }).id;
  const reservations = await db.ingredientReservation.findMany({ where: { orderId: id } });
  const expected = sumRecipeAmounts([{ amounts: recipeForDrink(name, size)!, qty: 2 }]);
  expect(new Map(reservations.map(row => [recipeAmountKey({ name: row.nameSnapshot, unit: row.unitSnapshot as 'L'|'KG' }), row.quantity.toFixed(3)])))
    .toEqual(new Map(expected.map(amount => [recipeAmountKey(amount), amount.quantity])));
  for (const amount of expected) {
    const row = await stock(amount.name); expect(row.quantity.toFixed(3)).toBe('1000.000'); expect(row.reservedQuantity.toFixed(3)).toBe(amount.quantity);
  }
  expect((await create(f).expect(201)).body).toEqual(made.body);
  await cancel(f, id).expect(200); await cancel(f, id).expect(200);
  for (const amount of expected) expect((await stock(amount.name)).reservedQuantity.isZero()).toBe(true);
  expect(await db.ingredientMovement.count({ where: { reservation: { orderId: id }, reservationAction: 'RESERVE' } })).toBe(expected.length);
  expect(await db.ingredientMovement.count({ where: { reservation: { orderId: id }, reservationAction: 'RELEASE' } })).toBe(expected.length);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(0);
});

test('selected topping quantities are frozen for the chosen size; Cold Brew always includes syrup', async () => {
  const f = await fixture('Cold brew', 'L', 3, '10000', ['Kem', 'Caramel']);
  const made = await create(f).expect(201), id = (made.body as { id: string }).id;
  const rows = await db.ingredientReservation.findMany({ where: { orderId: id } });
  expect(rows.find(row => row.nameSnapshot === 'Syrup đường')?.quantity.toFixed(3)).toBe('0.045');
  expect(rows.find(row => row.nameSnapshot === 'Kem tươi')?.quantity.toFixed(3)).toBe('0.120');
  expect(rows.find(row => row.nameSnapshot === 'Syrup caramel')?.quantity.toFixed(3)).toBe('0.060');
});

test('per-size availability and topping stock are independent', async () => {
  const f = await fixture('Latte', 'S', 1, '10000', ['Kem']);
  await db.ingredient.update({ where: { id: (await stock('Sữa tươi không đường')).id }, data: { quantity: '0.200' } });
  await db.ingredient.update({ where: { id: (await stock('Kem tươi')).id }, data: { quantity: '0' } });
  const detail = await request(app.getHttpServer()).get('/products/'+f.product.id).expect(200);
  expect(detail.body).toMatchObject({ available: true, sizes: [{ size: 'S', available: true, maxQuantity: 1 }, { size: 'M', available: false }, { size: 'L', available: false }], toppings: [{ availableSizes: [] }] });
  await create(f).expect(409);
});

test('shared ingredients are added across different drinks before any reservation is committed', async () => {
  const f = await fixture('Cappuccino', 'S', 2), other = await fixture('Latte', 'L', 2);
  await app.get(CartService).add(f.user, other.input);
  await db.ingredient.update({ where: { id: (await stock('Sữa tươi không đường')).id }, data: { quantity: '0.700' } });
  await request(app.getHttpServer()).post('/orders').set('Authorization', auth(f.user)).set('Idempotency-Key', f.key).send({ items: [f.input, other.input] }).expect(409);
  expect(await db.order.count({ where: { userId: f.user } })).toBe(0);
  expect(await db.ingredientReservation.count({ where: { order: { userId: f.user } } })).toBe(0);
  expect((await stock('Sữa tươi không đường')).reservedQuantity.isZero()).toBe(true);
});

test('two customers ordering different drinks cannot reserve the same final milk twice', async () => {
  const a = await fixture('Latte'), b = await fixture('Cappuccino');
  await db.ingredient.update({ where: { id: (await stock('Sữa tươi không đường')).id }, data: { quantity: '0.150' } });
  const results = await Promise.all([create(a), create(b)]);
  expect(results.map(result => result.status).sort()).toEqual([201,409]);
  const row = await stock('Sữa tươi không đường'); expect(row.reservedQuantity.lte(row.quantity)).toBe(true);
});

test('the final reserved serving can be paid; preparation consumes exactly once and cannot be cancelled as unused stock', async () => {
  const f = await fixture('Latte', 'S', 1, '0');
  await db.ingredient.update({ where: { id: (await stock('Sữa tươi không đường')).id }, data: { quantity: '0.150' } });
  const made = await create(f).expect(201), id = (made.body as { id: string }).id, key = randomUUID();
  await zero(f, id, key).expect(200); await zero(f, id, key).expect(200);
  await db.order.update({ where: { id }, data: { paidAt: new Date(Date.now()-121000) } });
  const paid = await db.order.findUniqueOrThrow({ where: { id } });
  await app.get(OrderService).transitionOrder(id, paid.version, 'PREPARING', staff);
  const milk = await stock('Sữa tươi không đường'); expect(milk.quantity.isZero()).toBe(true); expect(milk.reservedQuantity.isZero()).toBe(true);
  await expect(app.get(OrderService).transitionOrder(id, paid.version, 'PREPARING', staff)).rejects.toMatchObject({ status: 409 });
  await expect(app.get(OrderService).transitionOrder(id, paid.version+1, 'CANCELLED', admin)).rejects.toMatchObject({ status: 409 });
  expect(await db.ingredientMovement.count({ where: { reservation: { orderId: id }, reservationAction: 'CONSUME' } })).toBe(recipeForDrink('Latte','S')!.length);
});

test('paid cancellation before preparation releases quantities and never changes physical stock', async () => {
  const f = await fixture('Cacao đá', 'M', 2, '0'); const made = await create(f).expect(201), id = (made.body as { id: string }).id;
  await zero(f, id).expect(200); const paid = await db.order.findUniqueOrThrow({ where: { id } });
  await app.get(OrderService).transitionOrder(id, paid.version, 'CANCELLED', admin);
  await app.get(OrderService).transitionOrder(id, paid.version, 'CANCELLED', admin);
  const milk = await stock('Sữa tươi không đường'); expect(milk.quantity.toFixed(3)).toBe('1000.000'); expect(milk.reservedQuantity.isZero()).toBe(true);
});

test('verified payment failure releases once; retry uses the original snapshot and re-reserves once', async () => {
  const f = await fixture(); const made = await create(f).expect(201), id = (made.body as { id: string }).id;
  const started = await initiate(f,id).expect(201); const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: (started.body as { attemptId: string }).attemptId } });
  const fields = { vnp_TmnCode: profile.merchantCode, vnp_TxnRef: attempt.txnRef, vnp_Amount: '1000000', vnp_BankCode: 'NCB', vnp_OrderInfo: (attempt.requestParameters as Record<string,string>).vnp_OrderInfo, vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_TransactionNo: '0' };
  const raw = new URLSearchParams({ ...fields, vnp_SecureHash: signParameters(fields, profile.hashSecret) }).toString();
  expect(await app.get(IpnService).receive(raw)).toMatchObject({ RspCode: '00' });
  expect((await stock('Sữa tươi không đường')).reservedQuantity.isZero()).toBe(true);
  await db.product.update({ where: { id: f.product.id }, data: { name: 'Renamed after checkout' } });
  const retryKey = randomUUID(); await initiate(f,id,retryKey).expect(201); await initiate(f,id,retryKey).expect(201);
  expect((await stock('Sữa tươi không đường')).reservedQuantity.toFixed(3)).toBe('0.150');
  expect((await db.ingredientReservation.findFirstOrThrow({ where: { orderId: id } })).cycle).toBe(2);
});

test('ingredient count cannot overwrite committed stock, and historical product-stock orders retain their old behavior', async () => {
  const f = await fixture(); const made = await create(f).expect(201), id = (made.body as { id: string }).id;
  const milk = await stock('Sữa tươi không đường');
  const count = await app.get(IngredientService).createCount(staff, randomUUID(), { lines: [{ ingredientId: milk.id, expectedVersion: milk.version, actualQuantity: '0' }] });
  await expect(app.get(IngredientService).reviewCount(admin,count.id,{ action:'APPROVE',expectedVersion:0,note:'' })).rejects.toMatchObject({ response:{ code:'INVENTORY_CHANGED' } });
  await cancel(f,id).expect(200);
  const old = await db.order.create({ data: { userId:f.user,orderCode:randomUUID(),status:'PENDING',subtotal:'10000',total:'10000',items:{create:{productId:f.product.id,productNameSnapshot:'Latte',size:'S',basePrice:'10000',unitPrice:'10000',sizeExtraPrice:'0',qty:1,lineTotal:'10000'}} } });
  await cancel(f,old.id).expect(200); await cancel(f,old.id).expect(200);
  expect((await db.product.findUniqueOrThrow({ where:{id:f.product.id} })).stock).toBe(1);
});

test('a journal failure rolls back reservation, stock, order and idempotency together', async () => {
  const f = await fixture();
  await client.query("CREATE FUNCTION size_recipe_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reservation_id IS NOT NULL THEN RAISE EXCEPTION 'isolated journal fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER size_recipe_fault BEFORE INSERT ON ingredient_movements FOR EACH ROW EXECUTE FUNCTION size_recipe_fault()");
  try {
    await create(f).expect(503);
    expect(await db.order.count({ where:{userId:f.user} })).toBe(0);
    expect(await db.ingredientReservation.count({ where:{order:{userId:f.user}} })).toBe(0);
    expect((await stock('Sữa tươi không đường')).reservedQuantity.isZero()).toBe(true);
    expect(await db.idempotencyRequest.count({ where:{userId:f.user} })).toBe(0);
  } finally { await client.query('DROP TRIGGER size_recipe_fault ON ingredient_movements; DROP FUNCTION size_recipe_fault()'); }
});
});

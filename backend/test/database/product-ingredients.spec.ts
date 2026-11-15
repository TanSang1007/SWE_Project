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
import { productIngredientKeys } from '../../src/catalog/product-ingredients';
import { signParameters } from '../../src/payments/vnpay/vnpay-signing';
import { SANDBOX_PAYMENT_URL } from '../../src/payments/vnpay/vnpay-config';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !['127.0.0.1','localhost','[::1]'].includes(new URL(connectionString).hostname) || !/_test$/.test(new URL(connectionString).pathname)) throw Error('Explicit local test database required');
const schema = 'recipe_test_' + randomUUID().replaceAll('-', '');
const client = new Client({ connectionString });
const db = Object.assign(new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString, `-c search_path=${schema}`) }, { schema }) }), { transactionOptions: { maxWait: 2000, timeout: 5000 } });
const profile = { environment: 'SANDBOX', version: '2.1.0', merchantCode: 'TEST0001', hashSecret: 'synthetic-recipe-test-secret-only', paymentUrl: SANDBOX_PAYMENT_URL,
  returnUrl: 'https://callback.example.org/payments/vnpay/return', ipnUrl: 'https://callback.example.org/payments/vnpay/ipn' };
let app: NestExpressApplication, jwt: JwtService, admin: string, staff: string;
const auth = (user: string) => 'Bearer ' + jwt.sign({ sub: user });
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db)
    .overrideProvider(ConfigService).useValue(new ConfigService({ NODE_ENV: 'test', JWT_SECRET: 'synthetic-recipe-jwt-secret-of-at-least-32-bytes', JWT_EXPIRES_IN: 3600,
      PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_CONFIG: profile, VNPAY_ACCEPT_NEW_PAYMENTS: true }))
    .overrideProvider(PaymentExpirationWorker).useValue({}).overrideProvider(PaymentReceiptWorker).useValue({}).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  admin = (await db.user.create({ data: { email: randomUUID()+'@example.invalid', passwordHash: 'isolated-fixture', role: 'ADMIN' } })).id;
  staff = (await db.user.create({ data: { email: randomUUID()+'@example.invalid', passwordHash: 'isolated-fixture', role: 'STAFF' } })).id;
  await app.get(IngredientService).initializeCatalog(admin);
});
beforeEach(async () => { await db.ingredientReservation.updateMany({where:{state:'RESERVED'},data:{state:'RELEASED'}}); await db.ingredient.updateMany({ data: { quantity: '2',reservedQuantity:'0' } }); });
afterAll(async () => { if (app) await app.close(); await db.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
async function fixture(name = 'Latte', stock = 0, price = '10000') {
  const user = (await db.user.create({ data: { email: randomUUID()+'@example.invalid', passwordHash: 'isolated-fixture' } })).id;
  const product = await db.product.create({ data: { name, stock, price, imageUrl: '/images/latte.svg', sizes: { create: { size: 'S', extraPrice: '0' } } } });
  const input = { productId: product.id, size: 'S', qty: 3, toppingIds: [] };
  await app.get(CartService).add(user, input);
  return { user, product, input, key: randomUUID() };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const create = (f: Fixture) => request(app.getHttpServer()).post('/orders').set('Authorization', auth(f.user)).set('Idempotency-Key', f.key).send({ items: [f.input] });
const cancel = (f: Fixture, id: string) => request(app.getHttpServer()).post(`/orders/${id}/cancel`).set('Authorization', auth(f.user)).send({});
const initiate = (f: Fixture, id: string, key = randomUUID()) => request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', auth(f.user)).set('Idempotency-Key', key).send({ orderId: id });

test.each(['Cappuccino','Latte','Cold brew','Đen đá','Asian Dolce Latte','Matcha Coldwisk','Cacao đá'])('%s ignores manual zero, preserves balances and never restores unreserved product stock', async name => {
  const f = await fixture(name);
  const menu = await request(app.getHttpServer()).get(`/products/${f.product.id}`).expect(200); expect((menu.body as { available: boolean }).available).toBe(true);
  const cart = await app.get(CartService).get(f.user); expect(cart.items[0].available).toBe(true); expect(cart.items[0].stock).toBeGreaterThanOrEqual(f.input.qty);
  const balances = await db.ingredient.findMany({ orderBy: { id: 'asc' } });
  const result = await create(f).expect(201), id = (result.body as { id: string }).id;
  expect((result.body as { items: object[] }).items[0]).not.toHaveProperty('ingredientKeysSnapshot');
  expect((await db.orderItem.findFirstOrThrow({ where: { orderId: id } })).ingredientKeysSnapshot).toEqual(productIngredientKeys(name));
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(0);
  await cancel(f, id).expect(200); await cancel(f, id).expect(200);
  expect((await create(f).expect(201)).body).toEqual(result.body);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(0);
  expect((await db.ingredient.findMany({ orderBy: { id: 'asc' } })).map(row=>[row.id,row.quantity.toFixed(3),row.reservedQuantity.toFixed(3)])).toEqual(balances.map(row=>[row.id,row.quantity.toFixed(3),row.reservedQuantity.toFixed(3)]));
});
test('zero ingredient blocks menu/cart/new order despite manual stock, replenishment immediately restores availability', async () => {
  const f = await fixture('Latte', 100);
  const sugar = await db.ingredient.findUniqueOrThrow({ where: { normalizedName: 'syrup đường (công thức)' } });
  await db.ingredient.update({ where: { id: sugar.id }, data: { quantity: '0' } });
  expect(((await request(app.getHttpServer()).get(`/products/${f.product.id}`).expect(200)).body as { available: boolean }).available).toBe(false);
  expect((await app.get(CartService).get(f.user)).items[0].available).toBe(false);
  await create(f).expect(409); expect(await db.idempotencyRequest.count({ where: { userId: f.user } })).toBe(0);
  const receipt = await app.get(IngredientService).createReceipt(admin, randomUUID(), { lines: [{ ingredientId: sugar.id, quantity: '0.015' }] });
  await app.get(IngredientService).confirmReceipt(admin, receipt.id, 0);
  expect(((await request(app.getHttpServer()).get(`/products/${f.product.id}`).expect(200)).body as { available: boolean }).available).toBe(true);
  const restored = await create(f);
  expect(restored.body).toMatchObject({ status: 'PENDING' }); expect(restored.status).toBe(201);
});
test('Admin status exposes missing ingredients and rejects manual adjustments; Staff cannot read Admin inventory', async () => {
  const f = await fixture('Latte', 100);
  await db.ingredient.update({ where: { normalizedName: 'sữa tươi không đường (công thức)' }, data: { quantity: '0' } });
  const list = await request(app.getHttpServer()).get('/admin/inventory').set('Authorization', auth(admin)).expect(200);
  expect((list.body as { items: { productId: string }[] }).items.find(i => i.productId === f.product.id)).toMatchObject({ inventorySource: 'INGREDIENTS', available: false, missingIngredients: ['Sữa tươi không đường'] });
  await request(app.getHttpServer()).post(`/admin/products/${f.product.id}/inventory-adjustments`).set('Authorization', auth(admin)).set('Idempotency-Key', randomUUID()).send({ delta: 1, expectedVersion: 0 }).expect(409);
  await request(app.getHttpServer()).get('/admin/inventory').set('Authorization', auth(staff)).expect(403);
});
test('old snapshots default to product stock and restore once even when the product now has a recipe', async () => {
  const f = await fixture('Latte', 7);
  const order = await db.order.create({ data: { userId: f.user, orderCode: randomUUID(), status: 'PENDING', subtotal: '10000', total: '10000',
    items: { create: { productId: f.product.id, productNameSnapshot: 'Latte', size: 'S', basePrice: '10000', unitPrice: '10000', sizeExtraPrice: '0', qty: 1, lineTotal: '10000' } } } });
  await cancel(f, order.id).expect(200); await cancel(f, order.id).expect(200);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(8);
});
test('mixed orders reserve and restore only the legacy product, keeping recipe stock and ingredient balances unchanged', async () => {
  const recipe = await fixture(); const legacy = await fixture('Unconfigured fixture', 10);
  await app.get(CartService).add(recipe.user, legacy.input);
  const result = await request(app.getHttpServer()).post('/orders').set('Authorization', auth(recipe.user)).set('Idempotency-Key', randomUUID())
    .send({ items: [recipe.input, legacy.input] }).expect(201);
  expect((await db.product.findUniqueOrThrow({ where: { id: legacy.product.id } })).stock).toBe(7);
  expect((await db.product.findUniqueOrThrow({ where: { id: recipe.product.id } })).stock).toBe(0);
  await cancel(recipe, (result.body as { id: string }).id).expect(200);
  expect((await db.product.findUniqueOrThrow({ where: { id: legacy.product.id } })).stock).toBe(10);
  expect((await db.product.findUniqueOrThrow({ where: { id: recipe.product.id } })).stock).toBe(0);
});
test('ingredient balances stay locked through order creation; a changed balance cannot commit a stale order', async () => {
  const f = await fixture(); const stock = await db.ingredient.findUniqueOrThrow({ where: { normalizedName: 'syrup đường (công thức)' } });
  const writer = new Client({ connectionString }); await writer.connect(); await writer.query(`SET search_path TO "${schema}"`);
  await writer.query('BEGIN'); await writer.query('UPDATE ingredients SET quantity=0 WHERE id=$1', [stock.id]);
  const pending = create(f).then(r => r);
  await new Promise(resolve => setTimeout(resolve, 100)); await writer.query('COMMIT'); await writer.end();
  expect((await pending).status).toBe(409); expect(await db.order.count({ where: { userId: f.user } })).toBe(0);
});
test('zero confirmation uses committed ingredients when free stock is exhausted; paid cancellation leaves manual stock unchanged', async () => {
  const f = await fixture('Latte', 0, '0'); const made = await create(f).expect(201); const id = (made.body as { id: string }).id;
  const reserved=await db.ingredient.findUniqueOrThrow({where:{normalizedName:'syrup đường (công thức)'}});await db.ingredient.update({where:{id:reserved.id},data:{quantity:reserved.reservedQuantity}});
  const confirm = () => request(app.getHttpServer()).post(`/orders/${id}/confirm-zero`).set('Authorization', auth(f.user)).set('Idempotency-Key', randomUUID()).send({});
  await confirm().expect(200);
  const order = await db.order.findUniqueOrThrow({ where: { id } }); await app.get(OrderService).transitionOrder(id, order.version, 'CANCELLED');
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(0);
});
test('failed verified gateway payment and retry use ingredient snapshots without inventing product stock', async () => {
  const f = await fixture(); const made = await create(f).expect(201); const id = (made.body as { id: string }).id;
  const started = await initiate(f, id).expect(201); const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: (started.body as { attemptId: string }).attemptId } });
  const fields = { vnp_TmnCode: profile.merchantCode, vnp_TxnRef: attempt.txnRef, vnp_Amount: '3000000', vnp_BankCode: 'NCB', vnp_OrderInfo: (attempt.requestParameters as Record<string, string>).vnp_OrderInfo, vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_TransactionNo: '0' };
  const raw = new URLSearchParams({ ...fields, vnp_SecureHash: signParameters(fields, profile.hashSecret) }).toString();
  expect(await app.get(IpnService).receive(raw)).toMatchObject({ RspCode: '00' });
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(0);
  await db.ingredient.update({ where: { normalizedName: 'syrup đường (công thức)' }, data: { quantity: '0' } }); await initiate(f, id).expect(409);
  await db.ingredient.update({ where: { normalizedName: 'syrup đường (công thức)' }, data: { quantity: '1' } }); await initiate(f, id).expect(201);
  expect((await db.product.findUniqueOrThrow({ where: { id: f.product.id } })).stock).toBe(0);
});

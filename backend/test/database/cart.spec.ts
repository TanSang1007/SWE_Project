import { utcConnectionString } from '../../src/database/pg-connection';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PrismaClient } from '../../src/generated/prisma/client';
import { configureApp } from '../../src/common/configure-app';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local test database required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test DB required');
const schema = `brewlite_b08_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString) }, { schema }) });
let app: NestExpressApplication; let token: string; let other: string;
const productId = randomUUID(); const toppingId = randomUUID(); const secondTopping = randomUUID();
const input = { productId, size: 'M', toppingIds: [toppingId], qty: 2 };
let id: string; let before: unknown;
type CartBody = { items: { id: string; qty: number; unitPrice: string; lineTotal: string }[]; totalQuantity: number; subtotal: string };
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter((n) => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init();
  for (let i = 0; i < 2; i++) {
    const credentials = { email: `${randomUUID()}@example.invalid`, password: randomBytes(20).toString('hex') };
    await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/login').send(credentials).expect(200);
    if (i === 0) token = (login.body as { accessToken: string }).accessToken; else other = (login.body as { accessToken: string }).accessToken;
  }
  await prisma.product.create({ data: { id: productId, name: 'Cart fixture', price: '40000', stock: 1, imageUrl: '/images/test.jpg',
    sizes: { create: [{ size: 'M', extraPrice: '5000' }, { size: 'L', extraPrice: '10000' }] } } });
  for (const [id, price] of [[toppingId, '7000'], [secondTopping, '5000']]) {
    await prisma.topping.create({ data: { id, name: id, price } });
    await prisma.productTopping.create({ data: { productId, toppingId: id } });
  }
  before = await prisma.product.findUnique({ where: { id: productId } });
});
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
const get = (bearer = token) => request(app.getHttpServer()).get('/cart').set('Authorization', `Bearer ${bearer}`);
const add = (body: object) => request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${token}`).send(body);
test('GET empty cart is valid and does not create row; all endpoints protected', async () => {
  expect((await get().expect(200)).body).toEqual({ items: [], totalQuantity: 0, subtotal: '0', currency: 'VND' });
  expect(await prisma.cart.count()).toBe(0);
  await request(app.getHttpServer()).get('/cart').expect(401);
  await request(app.getHttpServer()).post('/cart/items').send(input).expect(401);
  await request(app.getHttpServer()).patch(`/cart/items/${randomUUID()}`).send({ qty: 1 }).expect(401);
  await request(app.getHttpServer()).delete(`/cart/items/${randomUUID()}`).expect(401);
});
test('add valid item prices DB exactly, quantity may exceed stock without reserving', async () => {
  const body = (await add(input).expect(201)).body as CartBody; id = body.items[0].id;
  expect(body).toMatchObject({ totalQuantity: 2, subtotal: '104000', items: [{ unitPrice: '52000', lineTotal: '104000', qty: 2 }] });
});
test('same configuration merges, UUID case/order normalized', async () => {
  const body = (await add({ ...input, productId: productId.toUpperCase(), toppingIds: [toppingId.toUpperCase()], qty: 1 }).expect(201)).body as CartBody;
  expect(body.items).toHaveLength(1); expect(body.items[0].id).toBe(id); expect(body.items[0].qty).toBe(3);
});
test('different size and toppings create separate rows; normalized set order merges', async () => {
  await add({ ...input, size: 'L', qty: 1 }).expect(201);
  await add({ ...input, toppingIds: [], qty: 1 }).expect(201);
  await add({ ...input, toppingIds: [toppingId, secondTopping], qty: 1 }).expect(201);
  const body = (await add({ ...input, toppingIds: [secondTopping, toppingId], qty: 1 }).expect(201)).body as CartBody;
  expect(body.items).toHaveLength(4); expect(body.totalQuantity).toBe(7); expect(body.subtotal).toBe('372000');
});
test.each([0, -1, 100, 1.5, '2', null])('invalid quantity %p rejected', async (qty) => { await add({ ...input, qty }).expect(400); });
test('invalid UUID/product/size/topping and duplicate toppings rejected', async () => {
  await add({ ...input, productId: 'invalid' }).expect(400);
  await add({ ...input, productId: randomUUID() }).expect(404);
  await add({ ...input, size: 'S' }).expect(400);
  await add({ ...input, size: 'XL' }).expect(400);
  await add({ ...input, toppingIds: [randomUUID()] }).expect(400);
  await add({ ...input, toppingIds: [toppingId, toppingId.toUpperCase()] }).expect(400);
  await add({ ...input, toppingIds: Array.from({ length: 11 }, () => randomUUID()) }).expect(400);
});
test('client cannot supply ownership or prices; PATCH cannot change configuration', async () => {
  await add({ ...input, userId: randomUUID() }).expect(400); await add({ ...input, unitPrice: '1' }).expect(400);
  await get().query({ userId: randomUUID() }).expect(400);
  for (const data of [{ qty: 2, size: 'L' }, { qty: 2, toppingIds: [] }, { qty: 2, productId }, { qty: 0 }]) {
    await request(app.getHttpServer()).patch(`/cart/items/${id}`).set('Authorization', `Bearer ${token}`).send(data).expect(400);
  }
});
test('ownership isolation: other user empty; PATCH/DELETE absent/cross owner 404', async () => {
  expect(((await get(other)).body as CartBody).items).toEqual([]);
  for (const target of [id, randomUUID()]) {
    await request(app.getHttpServer()).patch(`/cart/items/${target}`).set('Authorization', `Bearer ${other}`).send({ qty: 1 }).expect(404);
    await request(app.getHttpServer()).delete(`/cart/items/${target}`).set('Authorization', `Bearer ${other}`).expect(404);
  }
});
test('PATCH quantity and GET after re-login preserve DB cart', async () => {
  const body = (await request(app.getHttpServer()).patch(`/cart/items/${id}`).set('Authorization', `Bearer ${token}`).send({ qty: 4 }).expect(200)).body as CartBody;
  expect(body.totalQuantity).toBe(8); expect(body.subtotal).toBe('424000'); expect((await get().expect(200)).body).toEqual(body);
});
test('merged bound rollback; concurrent same configuration serializes without duplicates', async () => {
  await add({ ...input, qty: 99 }).expect(400);
  const responses = await Promise.all([add({ ...input, qty: 1 }), add({ ...input, qty: 1 })]);
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  expect(await prisma.cartItem.count({ where: { productId, size: 'M', configurationKey: [productId, 'M', toppingId].join(':') } })).toBe(1);
  expect(((await get()).body as CartBody).items.find((item) => item.id === id)?.qty).toBe(6);
});
test('unavailable add/update rejected, GET retained, DELETE allowed, no stock mutation', async () => {
  expect(await prisma.product.findUnique({ where: { id: productId } })).toEqual(before);
  await prisma.product.update({ where: { id: productId }, data: { stock: 0 } });
  await add(input).expect(409);
  await request(app.getHttpServer()).patch(`/cart/items/${id}`).set('Authorization', `Bearer ${token}`).send({ qty: 1 }).expect(409);
  await get().expect(200);
  await request(app.getHttpServer()).delete(`/cart/items/${id}`).set('Authorization', `Bearer ${token}`).expect(200);
  await request(app.getHttpServer()).delete(`/cart/items/${id}`).set('Authorization', `Bearer ${token}`).expect(404);
  await prisma.product.update({ where: { id: productId }, data: { stock: 1 } });
  expect(await prisma.product.findUnique({ where: { id: productId } })).toEqual(before);
});
test('Decimal money boundary exact; overflow rolls back item write', async () => {
  const p = await prisma.product.create({ data: { name: 'Precision', price: '999999999989', imageUrl: '/images/test.jpg', stock: 1, sizes: { create: { size: 'S', extraPrice: '10' } } } });
  // Use the empty second-user cart to avoid subtotal overflow from other lines.
  const call = (qty: number) => request(app.getHttpServer()).post('/cart/items').set('Authorization', `Bearer ${other}`).send({ productId: p.id, size: 'S', toppingIds: [], qty });
  expect(((await call(1).expect(201)).body as CartBody).subtotal).toBe('999999999999');
  await call(1).expect(400);
  expect(((await get(other)).body as CartBody).items[0].qty).toBe(1);
});
test('database CHECK/FK/unique constraints enforce persisted cart relations', async () => {
  const item = await prisma.cartItem.findFirstOrThrow({ where: { productId } });
  await expect(prisma.cartItem.update({ where: { id: item.id }, data: { qty: 0 } })).rejects.toThrow();
  await expect(prisma.cartItem.update({ where: { id: item.id }, data: { size: 'S' } })).rejects.toThrow();
  await expect(prisma.cartItem.create({ data: { cartId: item.cartId, productId, size: item.size, configurationKey: item.configurationKey, qty: 1 } })).rejects.toThrow();
  const cart = await prisma.cart.findUniqueOrThrow({ where: { id: item.cartId } });
  await expect(prisma.cart.create({ data: { userId: cart.userId } })).rejects.toThrow();
});
test('50 configuration bound permits merge but rejects new configuration without partial row', async () => {
  const count = await prisma.cartItem.count({ where: { cart: { user: { email: { endsWith: '@example.invalid' } } }, product: { name: { not: 'Precision' } } } });
  for (let index = count; index < 50; index++) {
    const p = await prisma.product.create({ data: { name: `Bound ${index}`, price: '1', imageUrl: '/images/test.jpg', stock: 1, sizes: { create: { size: 'S', extraPrice: '0' } } } });
    await add({ productId: p.id, size: 'S', toppingIds: [], qty: 1 }).expect(201);
  }
  await add({ ...input, size: 'L', qty: 1 }).expect(201);
  await add({ ...input, size: 'L', toppingIds: [], qty: 1 }).expect(400);
  expect(((await get()).body as CartBody).items).toHaveLength(50);
});

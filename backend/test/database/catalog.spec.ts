import { utcConnectionString } from '../../src/database/pg-connection';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/configure-app';
import { PrismaService } from '../../src/database/prisma.service';
import { CatalogService } from '../../src/catalog/catalog.service';
import request from 'supertest';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Catalog integration requires a local development/test URL');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) {
  throw new Error('Catalog tests only accept local databases ending in _dev or _test');
}
const schema = `brewlite_b05_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
// Only the test provider differs; runtime Catalog uses the existing PrismaService.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString) }, { schema }) });
const first = '11111111-1111-4111-8111-111111111111';
const second = '11111111-1111-4111-8111-111111111112';
const topping = '22222222-2222-4222-8222-222222222221';
let app: NestExpressApplication;
let service: CatalogService;

beforeAll(async () => {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  const migrations = resolve(__dirname, '../../prisma/migrations');
  for (const dir of readdirSync(migrations).filter((entry) => /^\d+_/.test(entry)).sort()) {
    await client.query(readFileSync(resolve(migrations, dir, 'migration.sql'), 'utf8'));
  }
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue(prisma).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app); await app.init(); service = app.get(CatalogService);
});
afterAll(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
  // Only this run's generated schema, never public or a pre-existing schema.
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});
beforeEach(async () => {
  await client.query('DELETE FROM product_toppings; DELETE FROM product_sizes; DELETE FROM products; DELETE FROM toppings');
  await client.query("INSERT INTO products(id,name,price,image_url,stock) VALUES($1,'Fixture available',44999,'/images/fixture.jpg',3),($2,'Fixture sold out',999999999999,'/images/other.jpg',0)", [first, second]);
  await client.query("INSERT INTO product_sizes VALUES($1,'L',12345),($1,'S',0),($2,'M',999)", [first, second]);
  await client.query("INSERT INTO toppings(id,name,price) VALUES($1,'Associated',9876),($2,'Other product only',111)", [topping, '22222222-2222-4222-8222-222222222222']);
  await client.query('INSERT INTO product_toppings VALUES($1,$2),($3,$4)', [first, topping, second, '22222222-2222-4222-8222-222222222222']);
});

describe('CatalogService with PostgreSQL', () => {
  it('lists real prices and availability without exposing stock/version/timestamps', async () => {
    expect(await service.listProducts()).toEqual({ items: [
      { id: first, name: 'Fixture available', price: '44999', imageUrl: '/images/fixture.jpg', available: true },
      { id: second, name: 'Fixture sold out', price: '999999999999', imageUrl: '/images/other.jpg', available: false },
    ], currency: 'VND' });
  });
  it('returns only associated options and their actual DB prices', async () => {
    expect(await service.getProduct(first)).toEqual({
      id: first, name: 'Fixture available', price: '44999', imageUrl: '/images/fixture.jpg', available: true,
      sizes: [{ size: 'S', extraPrice: '0' }, { size: 'L', extraPrice: '12345' }],
      toppings: [{ id: topping, name: 'Associated', price: '9876' }],
    });
    await client.query('UPDATE products SET price=45001 WHERE id=$1', [first]);
    await client.query('UPDATE toppings SET price=4321 WHERE id=$1', [topping]);
    await client.query('UPDATE product_sizes SET extra_price=6789 WHERE product_id=$1 AND size=$2', [first, 'L']);
    expect(await service.getProduct(first)).toMatchObject({ price: '45001', sizes: [{ size: 'S', extraPrice: '0' }, { size: 'L', extraPrice: '6789' }], toppings: [{ price: '4321' }] });
  });
  it('returns empty menu when no products exist', async () => {
    await client.query('DELETE FROM product_toppings; DELETE FROM product_sizes; DELETE FROM products');
    expect(await service.listProducts()).toEqual({ items: [], currency: 'VND' });
  });
  it('reports missing product and keeps sold-out product visible', async () => {
    await expect(service.getProduct(randomUUID())).rejects.toMatchObject({ status: 404 });
    expect(await service.getProduct(second)).toMatchObject({ available: false, price: '999999999999' });
  });
    it('excludes inactive/discontinued products from list and returns 404 on detail', async () => {
    const discontinuedId = '11111111-1111-4111-8111-111111111199';
    // 1. Thêm một sản phẩm đã ngừng bán (is_active = false)
    await client.query(
      "INSERT INTO products(id, name, price, image_url, stock, is_active) VALUES($1, 'Discontinued Drink', 35000, '/images/discontinued.jpg', 10, false)",
      [discontinuedId],
    );

    // 2. Kiểm tra listProducts: Tuyệt đối không được chứa sản phẩm ngừng bán
    const list = await service.listProducts();
    expect(list.items.some((item) => item.id === discontinuedId)).toBe(false);

    // 3. Kiểm tra getProduct: Phải ném 404 Not Found
    await expect(service.getProduct(discontinuedId)).rejects.toMatchObject({
      status: 404,
      message: 'Product not found',
    });
  });

  it('returns 404 error envelope when requesting non-existent product via HTTP', async () => {
    const nonExistentId = randomUUID();
    const result = await request(app.getHttpServer()).get(`/products/${nonExistentId}`).expect(404);
    expect(result.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Product not found',
        details: [],
        requestId: expect.any(String) as unknown,
      },
    });
  });
});

describe('Catalog HTTP with PostgreSQL', () => {
  it('GET list -> 200 with exact JSON contract', async () => {
    await request(app.getHttpServer()).get('/products').expect(200, await service.listProducts());
  });
  it('GET existing detail -> 200 with associated options', async () => {
    await request(app.getHttpServer()).get(`/products/${first}`).expect(200, await service.getProduct(first));
  });
  it('missing UUID -> shared 404 error envelope', async () => {
    const result = await request(app.getHttpServer()).get(`/products/${randomUUID()}`).expect(404);
    expect(result.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Product not found', details: [], requestId: expect.any(String) as unknown } });
  });
  it('invalid UUID -> shared validation error', async () => {
    const result = await request(app.getHttpServer()).get('/products/invalid').expect(400);
    expect(result.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: ['id must be a UUID'], requestId: expect.any(String) as unknown } });
  });
  it.each(['/products?limit=1', `/products/${first}?category=coffee`, '/products?sort=price', '/products?search=fixture'])('rejects unsupported query %s', async (endpoint) => {
    const result = await request(app.getHttpServer()).get(endpoint).expect(400);
    expect(result.body).toMatchObject({ error: { code: 'VALIDATION_ERROR', details: expect.any(Array) as unknown } });
  });
  it('empty catalog returns 200 and optionless detail returns empty option arrays', async () => {
    await client.query('DELETE FROM product_toppings; DELETE FROM product_sizes');
    expect(await service.getProduct(first)).toMatchObject({ sizes: [], toppings: [] });
    await client.query('DELETE FROM products');
    await request(app.getHttpServer()).get('/products').expect(200, { items: [], currency: 'VND' });
  });
  it.each(['post', 'put', 'patch', 'delete'] as const)('has no %s catalog endpoint', async (method) => {
    await request(app.getHttpServer())[method]('/products').send({ stock: 99 }).expect(404);
  });
  it('reads leave catalog/stock unchanged', async () => {
    const snapshot = async (): Promise<Record<string, unknown>[]> => (await client.query<Record<string, unknown>>('SELECT id,price::text,stock,version,created_at,updated_at FROM products ORDER BY id')).rows;
    const before = await snapshot();
    await request(app.getHttpServer()).get('/products').expect(200);
    await request(app.getHttpServer()).get(`/products/${first}`).expect(200);
    expect(await snapshot()).toEqual(before);
  });
  it('serves B04 seed shape and exact money values without seed changes', async () => {
    await client.query('DELETE FROM product_toppings; DELETE FROM product_sizes; DELETE FROM products; DELETE FROM toppings');
    const seedUrl = new URL(connectionString);
    seedUrl.searchParams.set('options', `-c search_path=${schema}`);
    execFileSync(process.execPath, [resolve(__dirname, '../../prisma/seed.cjs')], {
      env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: seedUrl.toString() }, stdio: 'pipe',
    });
    await request(app.getHttpServer()).get('/products').expect(200, { items: [
      { id: first, name: 'Cappuccino', price: '45000', imageUrl: '/images/cappuccino.jpg', available: true },
      { id: second, name: 'Latte', price: '40000', imageUrl: '/images/latte.jpg', available: true },
    ], currency: 'VND' });
    await request(app.getHttpServer()).get(`/products/${first}`).expect(200, {
      id: first, name: 'Cappuccino', price: '45000', imageUrl: '/images/cappuccino.jpg', available: true,
      sizes: [{ size: 'S', extraPrice: '0' }, { size: 'M', extraPrice: '5000' }, { size: 'L', extraPrice: '10000' }],
      toppings: [{ id: topping, name: 'Kem', price: '5000' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Caramel', price: '7000' }],
    });
  });
});

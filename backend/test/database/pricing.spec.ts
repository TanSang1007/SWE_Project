import { utcConnectionString } from '../../src/database/pg-connection';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PricingService } from '../../src/pricing/pricing.service';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local test database required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test DB required');
const schema = `brewlite_b09_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString) }, { schema }) });
const service = new PricingService();
const userId = randomUUID(); const otherId = randomUUID(); const productId = randomUUID(); const toppingId = randomUUID(); const promotionId = randomUUID();
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  const dir = resolve(__dirname, '../../prisma/migrations');
  for (const name of readdirSync(dir).filter((n) => /^\d+_/.test(n)).sort()) await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
  for (const id of [userId, otherId]) await prisma.user.create({ data: { id, email: `${id}@example.invalid`, passwordHash: 'test-only-not-a-login' } });
  await prisma.product.create({ data: { id: productId, name: 'Pricing fixture', price: '40000', stock: 5, imageUrl: '/images/test.jpg',
    sizes: { create: [{ size: 'M', extraPrice: '5000' }, { size: 'L', extraPrice: '10000' }] } } });
  await prisma.topping.create({ data: { id: toppingId, name: 'Cream', price: '7000' } });
  await prisma.productTopping.create({ data: { productId, toppingId } });
  await prisma.cart.create({ data: { userId, items: { create: ['M', 'L'].map((size, index) => ({ productId, size, qty: index + 2,
    configurationKey: [productId, size, toppingId].join(':'), toppings: { create: { toppingId } } })) } } });
  await prisma.promotion.create({ data: { id: promotionId, code: 'TESTONLY', discountAmount: '10000', minimumSubtotal: '0',
    isActive: true, startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01') } });
});
afterAll(async () => { await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
const run = (owner = userId, promo?: string) => prisma.$transaction((tx) => service.validateCart(tx, owner, promo));
async function snapshot() {
  return { carts: await prisma.cart.findMany(), items: await prisma.cartItem.findMany({ orderBy: { id: 'asc' } }),
    selected: await prisma.cartItemTopping.findMany({ orderBy: { cartItemId: 'asc' } }), products: await prisma.product.findMany(),
    users: await prisma.user.findMany({ select: { id: true, loyaltyPoints: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    orders: await prisma.order.count(), orderItems: await prisma.orderItem.count(), payments: await prisma.payment.count(), awards: await prisma.loyaltyAward.count() };
}
test('real PostgreSQL transaction: exact prices, discount, stock aggregate and no business mutation', async () => {
  const before = await snapshot(); const result = await run(userId, promotionId);
  expect(result.subtotal.toFixed(0)).toBe('275000'); expect(result.finalAmount.toFixed(0)).toBe('265000');
  expect(result.stockRequirements).toEqual([{ productId, qty: 5, stock: 5, version: 0 }]);
  expect(await snapshot()).toEqual(before);
  expect(before.orders + before.orderItems + before.payments + before.awards).toBe(0);
});
test('ownership isolation and missing identity', async () => { await expect(run(otherId)).rejects.toThrow(); await expect(run(randomUUID())).rejects.toThrow(); });
test.each(['base', 'size', 'topping'])('real %s price drift recomputes without changing Cart', async (field) => {
  const before = await prisma.cartItem.findMany({ orderBy: { id: 'asc' } });
  try {
    if (field === 'base') await prisma.product.update({ where: { id: productId }, data: { price: '40001' } });
    if (field === 'size') await prisma.productSize.update({ where: { productId_size: { productId, size: 'M' } }, data: { extraPrice: '5001' } });
    if (field === 'topping') await prisma.topping.update({ where: { id: toppingId }, data: { price: '7001' } });
    expect((await run()).subtotal.toFixed(0)).toBe(field === 'size' ? '275002' : '275005');
    expect(await prisma.cartItem.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  } finally {
    await prisma.product.update({ where: { id: productId }, data: { price: '40000' } });
    await prisma.productSize.update({ where: { productId_size: { productId, size: 'M' } }, data: { extraPrice: '5000' } });
    await prisma.topping.update({ where: { id: toppingId }, data: { price: '7000' } });
  }
});
test('aggregate insufficient stock and unavailable rejection preserve every business table', async () => {
  try {
    for (const stock of [4, 0]) {
      await prisma.product.update({ where: { id: productId }, data: { stock } }); const before = await snapshot();
      await expect(run()).rejects.toThrow(); expect(await snapshot()).toEqual(before);
    }
  } finally { await prisma.product.update({ where: { id: productId }, data: { stock: 5 } }); }
});
test('removed topping association invalidates persisted cart, no mutation', async () => {
  await prisma.productTopping.delete({ where: { productId_toppingId: { productId, toppingId } } });
  try { const before = await snapshot(); await expect(run()).rejects.toThrow(); expect(await snapshot()).toEqual(before); }
  finally { await prisma.productTopping.create({ data: { productId, toppingId } }); }
});
test('DB fixed discount above subtotal yields exact zero', async () => {
  await prisma.promotion.update({ where: { id: promotionId }, data: { discountAmount: '300000' } });
  const before = await snapshot(); const result = await run(userId, promotionId);
  expect(result.discountAmount.toFixed(0)).toBe('275000'); expect(result.finalAmount.toFixed(0)).toBe('0'); expect(await snapshot()).toEqual(before);
});

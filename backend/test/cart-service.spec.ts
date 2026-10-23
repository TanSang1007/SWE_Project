import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import { CartService } from '../src/cart/cart.service';
import { jest, test, expect } from '@jest/globals';

const decimal = (value: string) => new Prisma.Decimal(value);
function fixture() {
  const row = {
    id: 'item', productId: 'product', size: 'M', qty: 2,
    product: { name: 'Coffee', imageUrl: '/coffee.jpg', price: decimal('40000'), isActive: true, stock: 1, toppings: [{ toppingId: 'topping' }] },
    productSize: { size: 'M', extraPrice: decimal('5000'), isActive: true },
    toppings: [{ toppingId: 'topping', topping: { id: 'topping', name: 'Cream', price: decimal('7000'), isActive: true } }],
  };
  const tx = {
  cartItem: {
    findMany: jest.fn(async () => [row]),
    },
  };
  const prisma = { $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
  const service = new CartService(prisma as unknown as PrismaService);
  return { row, service };
}

test('cart uses current prices and permits quantity exceeding stock without reserving it', async () => {
  const { row, service } = fixture();
  expect(await service.get('owner')).toMatchObject({ subtotal: '104000', totalQuantity: 2, items: [{ unitPrice: '52000', lineTotal: '104000', available: true }] });
  row.product.price = decimal('41000');
  expect((await service.get('owner')).subtotal).toBe('106000');
  expect(row.product.stock).toBe(1);
});

test.each(['NaN', 'Infinity', '-1', '0.5', '1000000000000'])('cart rejects invalid base price %s', async (value) => {
  const { row, service } = fixture(); row.product.price = decimal(value);
  await expect(service.get('owner')).rejects.toMatchObject({ status: 400, response: { code: 'VALIDATION_ERROR' } });
});

test('fractional components cannot cancel to produce an apparently valid integer total', async () => {
  const { row, service } = fixture();
  row.product.price = decimal('40000.5'); row.productSize.extraPrice = decimal('4999.5');
  await expect(service.get('owner')).rejects.toMatchObject({ status: 400 });
});

test.each(['size', 'topping'])('negative %s price cannot hide inside a positive total', async (field) => {
  const { row, service } = fixture();
  if (field === 'size') row.productSize.extraPrice = decimal('-1');
  else row.toppings[0].topping.price = decimal('-1');
  await expect(service.get('owner')).rejects.toMatchObject({ status: 400 });
});

test('maximum VND is exact and line overflow is rejected', async () => {
  const { row, service } = fixture(); row.qty = 1; row.product.price = decimal('999999987999');
  expect((await service.get('owner')).subtotal).toBe('999999999999');
  row.qty = 2;
  await expect(service.get('owner')).rejects.toMatchObject({ status: 400 });
});

test.each([0, -1, 100, 1.5, NaN, Infinity])('service rejects quantity %p even without HTTP validation', async (qty) => {
  const { service } = fixture();
  await expect(service.add('owner', { productId: 'product', size: 'M', toppingIds: [], qty })).rejects.toMatchObject({ status: 400 });
  await expect(service.update('owner', 'item', qty)).rejects.toMatchObject({ status: 400 });
});

test('service rejects more than ten toppings before accessing catalog', async () => {
  const { service } = fixture();
  await expect(service.add('owner', { productId: 'product', size: 'M', toppingIds: Array(11).fill('topping') as string[], qty: 1 })).rejects.toMatchObject({ status: 400 });
});

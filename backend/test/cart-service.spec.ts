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
    findMany: jest.fn(() => Promise.resolve([row])),
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

test('stock warning aggregates demand across sizes without reserving or changing prices', async () => {
  const row = { id: 'one', productId: 'product', size: 'M', qty: 2,
    product: {name: 'Coffee', imageUrl: '', price: decimal('10000'), isActive: true, stock: 3, toppings: []},
    productSize: {size: 'M', extraPrice: decimal('0'), isActive: true}, toppings: [] };
  const tx = {cartItem: {findMany: jest.fn(() => Promise.resolve([row, {...row, id: 'two', size: 'L'}]))}};
  const prisma = {$transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx)};
  const service = new CartService(prisma as unknown as PrismaService);
  expect(await service.get('owner')).toMatchObject({subtotal: '40000', items: [
    {stock: 3, requestedQuantity: 4, available: true}, {stock: 3, requestedQuantity: 4, available: true},
  ]});
});

function optionsFixture(mergedQty?: number) {
  const item = {id: 'old', cartId: 'cart', productId: 'product', qty: 2, size: 'M', configurationKey: 'product:M', toppings: []};
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([])),
    order: {findFirst: jest.fn(() => Promise.resolve(null))},
    product: {findUnique: jest.fn(() => Promise.resolve({isActive: true, stock: 10, sizes: [{size: 'L', isActive: true}], toppings: []}))},
    cartItem: {
      findFirst: jest.fn(() => Promise.resolve(item)),
      findUnique: jest.fn(() => Promise.resolve(mergedQty === undefined ? null : {id: 'target', qty: mergedQty})),
      update: jest.fn((args: unknown) => Promise.resolve(args)), delete: jest.fn((args: unknown) => Promise.resolve(args)),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    cart: {update: jest.fn(() => Promise.resolve({}))},
  };
  const prisma = {$transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx))};
  return {tx, prisma, service: new CartService(prisma as unknown as PrismaService)};
}
test('option edit changes the existing row without a temporary 51st row', async () => {
  const {service, tx, prisma} = optionsFixture();
  await service.editOptions('owner', 'old', {size: 'L', toppingIds: []});
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  expect(tx.cartItem.update).toHaveBeenCalledWith({where: {id: 'old'}, data: {
    size: 'L', configurationKey: 'product:L', toppings: {deleteMany: {}, create: []},
  }});
  expect(tx.cartItem.delete).not.toHaveBeenCalled();
});
test('option edit merges existing quantity and deletes source inside the same transaction', async () => {
  const {service, tx} = optionsFixture(3);
  await service.editOptions('owner', 'old', {size: 'L', toppingIds: []});
  expect(tx.cartItem.update).toHaveBeenCalledWith({where: {id: 'target'}, data: {qty: 5}});
  expect(tx.cartItem.delete).toHaveBeenCalledWith({where: {id: 'old'}});
});
test('merged quantity overflow rejects before either row is written', async () => {
  const {service, tx} = optionsFixture(98);
  await expect(service.editOptions('owner', 'old', {size: 'L', toppingIds: []})).rejects.toMatchObject({status: 400});
  expect(tx.cartItem.update).not.toHaveBeenCalled(); expect(tx.cartItem.delete).not.toHaveBeenCalled();
});
test('option edit does not disclose or mutate another owner item', async () => {
  const {service, tx} = optionsFixture();
  tx.cartItem.findFirst.mockResolvedValueOnce(null as never);
  await expect(service.editOptions('other', 'old', {size: 'L', toppingIds: []})).rejects.toMatchObject({status: 404});
  expect(tx.cartItem.update).not.toHaveBeenCalled();
});

/// <reference types="jest" />
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import { OrderService } from '../src/orders/order.service';
import { PricingService } from '../src/pricing/pricing.service';
import { PaymentService } from '../src/payments/payment.service';
import { CartService } from '../src/cart/cart.service';
import { MockPaymentService } from '../src/payments/mock-payment.service';
import * as loyalty from '../src/loyalty/loyalty-accounting';

const decimal = (value: number) => new Prisma.Decimal(value);
function fixture() {
  const userId = randomUUID(), productId = randomUUID(), cartId = randomUUID();
  const selection = { productId, size: 'M', toppingIds: [], qty: 2 };
  const cartItems = [{ id: randomUUID(), cartId, ...selection, configurationKey: `${productId}:M`, toppings: [] }];
  const row = { id: randomUUID(), userId, orderCode: 'BL-fixture', status: 'PENDING', items: [{
    ...selection, productNameSnapshot: 'Latte', basePrice: decimal(5000), sizeExtraPrice: decimal(0), unitPrice: decimal(5000), lineTotal: decimal(10000), toppings: [],
  }], subtotal: decimal(10000), discountAmount: decimal(0), total: decimal(10000),
    promotionCodeSnapshot: null, redeemedPoints: 0, loyaltyDiscountAmount: decimal(0), redemptionState: 'NONE',
    reservationCycle: 0, version: 0, payments: [], loyaltyAward: null, createdAt: new Date(), paidAt: null };
  let created = false, stock = 10;
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0), $queryRaw: jest.fn().mockResolvedValue([]),
    cart: { findUnique: jest.fn(() => Promise.resolve({ id: cartId, userId, items: cartItems })), updateMany: jest.fn().mockResolvedValue({count: 1}) },
    cartItem: {
      findMany: jest.fn(() => Promise.resolve(cartItems)),
      delete: jest.fn((args: {where: {id: string}}) => {const index=cartItems.findIndex(i=>i.id===args.where.id);if(index>=0)cartItems.splice(index,1);return Promise.resolve({});}),
      update: jest.fn((args: {where: {id: string};data:{qty:number}}) => {const item=cartItems.find(i=>i.id===args.where.id)!;item.qty=args.data.qty;return Promise.resolve(item);}),
      deleteMany: jest.fn(() => { cartItems.splice(0); return Promise.resolve({ count: 1 }); }) },
    idempotencyRequest: { findUnique: jest.fn().mockResolvedValue(null), 
      create: jest.fn().mockResolvedValue({ id: randomUUID() }), update: jest.fn().mockResolvedValue({}) },
    order: {
      findFirst: jest.fn((args: {where:{status?:{in:string[]}}}) => Promise.resolve(created && (!args.where.status || args.where.status.in.includes(row.status)) ? {...row} : null)),
      create: jest.fn((args: { data: { id: string; orderCode: string } }) => {
        created = true; Object.assign(row, args.data); return Promise.resolve({ ...row });
      }),
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ ...row })),
      findFirstOrThrow: jest.fn(() => Promise.resolve({ ...row })),
      updateMany: jest.fn((args: { data: { status: string; version: { increment: number } } }) => {
        row.status = args.data.status; row.version += args.data.version.increment; return Promise.resolve({ count: 1 });
      }),
    },
    orderItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    product: {
      findUniqueOrThrow: jest.fn(() => Promise.resolve({ id: productId, stock, version: 0 })),
      updateMany: jest.fn((args: { data: { stock: { increment?: number; decrement?: number } } }) => {
        stock += (args.data.stock.increment ?? 0) - (args.data.stock.decrement ?? 0);
        return Promise.resolve({ count: 1 });
      }),
    },
    paymentAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
    paymentVerification: {findFirst: jest.fn().mockResolvedValue(null)},
    payment: { create: jest.fn((args: { data: object }) => Promise.resolve(args.data)) },
    loyaltyAward: { create: jest.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const pricing = { validateCart: jest.fn().mockResolvedValue({ items: [{ ...row.items[0],
    cartItemId: cartItems[0].id, productName: 'Latte', basePrice: decimal(5000), sizeExtraPrice: decimal(0),
  }], stockRequirements: [{ productId, qty: 2, stock: 10, version: 0 }],
  subtotal: decimal(10000), discountAmount: decimal(0), finalAmount: decimal(10000) }) } as unknown as PricingService;
  const config = new ConfigService({ PAYMENT_PROVIDER_MODE: 'MOCK', PAYMENT_MOCK_MODE: 'FAILURE' });
  jest.spyOn(loyalty, 'reconcileAccount').mockResolvedValue({ userId, available: 0n, debt: 0n, reserved: 0n });
  jest.spyOn(loyalty, 'persistEffects').mockResolvedValue(undefined);
  return { db, cart: new CartService(db), userId, selection, cartItems, tx, row, config, stock: () => stock,
    orders: new OrderService(db, pricing, config), payments: new PaymentService(db, new MockPaymentService(config), config) };
}
afterEach(() => jest.restoreAllMocks());

test('real create → failed payment → failed retry keeps original Cart and does not duplicate quantities', async () => {
  const f = fixture(); const before = structuredClone(f.cartItems);
  const order = await f.orders.create(f.userId, randomUUID(), { items: [f.selection] });
  expect(order.body).toMatchObject({ status: 'PENDING' }); expect(f.stock()).toBe(8);
  expect(f.cartItems).toEqual(before);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.payments.pay(f.userId, randomUUID(), { orderId: f.row.id, method: 'WALLET' });
    expect(result.body).toMatchObject({ order: { status: 'PAYMENT_FAILED' } }); expect(f.stock()).toBe(10);
    expect(f.cartItems).toEqual(before);
  }
  expect(f.tx.cartItem.deleteMany).not.toHaveBeenCalled();
  expect(f.tx.loyaltyAward.create).not.toHaveBeenCalled();
});

test('success clears the entire owner cart; a duplicate confirmation cannot clear twice', async () => {
  const f=fixture();await f.orders.create(f.userId,randomUUID(),{items:[f.selection]});
  f.config.set('PAYMENT_MOCK_MODE','SUCCESS');
  await f.payments.pay(f.userId,randomUUID(),{orderId:f.row.id,method:'WALLET'});
  expect(f.cartItems).toHaveLength(0);
  expect(f.tx.cartItem.deleteMany).toHaveBeenCalledWith({where:{cart:{userId:f.userId}}});
  await expect(f.payments.pay(f.userId,randomUUID(),{orderId:f.row.id,method:'WALLET'})).rejects.toMatchObject({status:409});
  expect(f.tx.cartItem.deleteMany).toHaveBeenCalledTimes(1);
});
test.each(['PENDING','PAYMENT_FAILED'])('active %s rejects add, quantity, options and removal before any Cart write',async status=>{
  const f=fixture();await f.orders.create(f.userId,randomUUID(),{items:[f.selection]});
  f.row.status=status;
  const item=f.cartItems[0];
  const before=structuredClone(f.cartItems);
  for(const action of [()=>f.cart.add(f.userId,f.selection),()=>f.cart.update(f.userId,item.id,3),
    ()=>f.cart.editOptions(f.userId,item.id,{size:'L',toppingIds:[]}),()=>f.cart.remove(f.userId,item.id)]) {
    await expect(action()).rejects.toMatchObject({status:409,response:{code:'INVALID_ORDER_STATE',details:{existingOrderId:f.row.id}}});
  }
  expect(f.cartItems).toEqual(before);expect(f.tx.cartItem.deleteMany).not.toHaveBeenCalled();
});
test('failed payment preserves cart; successful retry clears all of it',async()=>{
  const f=fixture();await f.orders.create(f.userId,randomUUID(),{items:[f.selection]});
  await f.payments.pay(f.userId,randomUUID(),{orderId:f.row.id,method:'WALLET'});
  expect(f.cartItems).toHaveLength(1);expect(f.stock()).toBe(10);
  f.config.set('PAYMENT_MOCK_MODE','SUCCESS');
  await f.payments.pay(f.userId,randomUUID(),{orderId:f.row.id,method:'WALLET'});
  expect(f.cartItems).toHaveLength(0);expect(f.stock()).toBe(8);
});
test('zero-total confirmation clears the entire cart too',async()=>{
  const {ZeroConfirmationService}=await import('../src/payments/zero-confirmation.service');
  const f=fixture();await f.orders.create(f.userId,randomUUID(),{items:[f.selection]});
  f.row.total=decimal(0);f.row.discountAmount=f.row.subtotal;
  expect((await new ZeroConfirmationService(f.db).confirm(f.userId,randomUUID(),f.row.id)).body).toMatchObject({order:{status:'PAID'}});
  expect(f.cartItems).toHaveLength(0);
});
test('cleanup error rejects confirmation rather than reporting partial success',async()=>{
  const f=fixture();await f.orders.create(f.userId,randomUUID(),{items:[f.selection]});
  f.config.set('PAYMENT_MOCK_MODE','SUCCESS');f.tx.cartItem.deleteMany.mockRejectedValueOnce(new Error('database failure'));
  await expect(f.payments.pay(f.userId,randomUUID(),{orderId:f.row.id,method:'WALLET'})).rejects.toMatchObject({status:503});
  expect(f.tx.idempotencyRequest.update).toHaveBeenCalledTimes(1);
});
test('cancelled/paid orders no longer hold the Cart write gate',async()=>{
  const {assertNoActiveOrder}=await import('../src/orders/order-policy');
  const f=fixture();await f.orders.create(f.userId,randomUUID(),{items:[f.selection]});
  for(const status of ['CANCELLED','PAID']) {
    f.row.status=status;await expect(assertNoActiveOrder(f.tx as unknown as Prisma.TransactionClient,f.userId)).resolves.toBeUndefined();
  }
});

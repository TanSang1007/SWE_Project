import { Prisma } from '../src/generated/prisma/client';
import { PricingService, type PricingReader } from '../src/pricing/pricing.service';

const decimal = (value: string) => new Prisma.Decimal(value);
function fixture() {
  const product = { id: 'p', name: 'Drink', price: decimal('40000'), stock: 5, version: 0, isActive: true,
    sizes: [{ productId: 'p', size: 'M', extraPrice: decimal('5000'), isActive: true }, { productId: 'p', size: 'L', extraPrice: decimal('10000'), isActive: true }],
    toppings: [{ productId: 'p', toppingId: 't', topping: { id: 't', name: 'Cream', price: decimal('7000'), isActive: true } }] };
  const cart = { id: 'c', userId: 'u', items: [{ id: 'i', cartId: 'c', productId: 'p', size: 'M', qty: 2,
    configurationKey: 'p:M:t', toppings: [{ toppingId: 't' }] }] };
  const promotion = { discountAmount: decimal('10000'), minimumSubtotal: decimal('0'), isActive: true,
    startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01') };
  const reader = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'u' }) }, cart: { findUnique: jest.fn().mockResolvedValue(cart) },
    product: { findMany: jest.fn().mockResolvedValue([product]) }, promotion: { findUnique: jest.fn().mockResolvedValue(promotion) } };
  const run = (promotionId?: string) => new PricingService().validateCart(reader as unknown as PricingReader, 'u', promotionId);
  return { product, cart, promotion, reader, run };
}
test('valid cart recomputes exact unit, line, subtotal and has zero default discount', async () => {
  const f = fixture(); const result = await f.run();
  expect(result.items[0].unitPrice.toFixed(0)).toBe('52000'); expect(result.subtotal.toFixed(0)).toBe('104000');
  expect(result.finalAmount.toFixed(0)).toBe('104000'); expect(result.discountAmount.toFixed(0)).toBe('0');
  expect(f.reader.cart.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u' } }));
});
test.each([0, -1, 100, 1.5, NaN])('rejects quantity %p', async (qty) => {
  const f = fixture(); f.cart.items[0].qty = qty; await expect(f.run()).rejects.toThrow();
});
test('empty cart rejected', async () => { const f = fixture(); f.cart.items = []; await expect(f.run()).rejects.toThrow(); });
test('absent cart rejected', async () => { const f = fixture(); f.reader.cart.findUnique.mockResolvedValue(null); await expect(f.run()).rejects.toThrow(); });
test('missing product rejected', async () => { const f = fixture(); f.reader.product.findMany.mockResolvedValue([]); await expect(f.run()).rejects.toThrow('Product not found'); });
test.each([0, 1])('unavailable/insufficient stock %p rejected', async (stock) => { const f = fixture(); f.product.stock = stock; await expect(f.run()).rejects.toThrow(); });
test('exact stock accepted', async () => { const f = fixture(); f.product.stock = 2; await expect(f.run()).resolves.toBeDefined(); });
test('aggregate stock across sizes: 2+3 exceeds 4, fits 5', async () => {
  const f = fixture(); f.cart.items.push({ ...f.cart.items[0], id: 'j', size: 'L', qty: 3, configurationKey: 'p:L:t' });
  f.product.stock = 4; await expect(f.run()).rejects.toThrow(); f.product.stock = 5;
  const result = await f.run(); expect(result.stockRequirements[0].qty).toBe(5); expect(result.subtotal.toFixed(0)).toBe('275000');
});
test('invalid size association rejected', async () => { const f = fixture(); f.product.sizes = []; await expect(f.run()).rejects.toThrow(); });
test('invalid topping association rejected', async () => { const f = fixture(); f.product.toppings = []; await expect(f.run()).rejects.toThrow(); });
test.each(['size', 'topping'])('retired %s rejects new pricing without changing stored Cart', async kind => {
  const f = fixture(); const cart = JSON.stringify(f.cart);
  if (kind === 'size') f.product.sizes[0].isActive = false; else f.product.toppings[0].topping.isActive = false;
  await expect(f.run()).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_ITEM_OPTIONS' } }); expect(JSON.stringify(f.cart)).toBe(cart);
});
test.each(['base', 'size', 'topping'])('%s price drift uses current DB price', async (field) => {
  const f = fixture(); await f.run();
  if (field === 'base') f.product.price = f.product.price.plus(1);
  if (field === 'size') f.product.sizes[0].extraPrice = f.product.sizes[0].extraPrice.plus(1);
  if (field === 'topping') f.product.toppings[0].topping.price = f.product.toppings[0].topping.price.plus(1);
  expect((await f.run()).subtotal.toFixed(0)).toBe('104002');
});
test.each(['10000', '104000', '200000'])('fixed configured DB discount %s capped at subtotal', async (amount) => {
  const f = fixture(); f.promotion.discountAmount = decimal(amount); const result = await f.run('promo');
  expect(result.discountAmount.toFixed(0)).toBe(Prisma.Decimal.min('104000', amount).toFixed(0));
  expect(result.finalAmount.toFixed(0)).toBe(Prisma.Decimal.max(0, decimal('104000').minus(amount)).toFixed(0));
});
test.each(['0', '-1', '0.1', '1000000000000', 'NaN', 'Infinity'])('invalid configured discount %s uses promotion contract', async (amount) => {
  const f = fixture(); f.promotion.discountAmount = decimal(amount);
  await expect(f.run('promo')).rejects.toMatchObject({ status: 422, response: { code: 'PROMOTION_INVALID' } });
});
test.each(['-1', '0.1', '1000000000000'])('invalid minimum subtotal %s uses promotion contract', async (amount) => {
  const f = fixture(); f.promotion.minimumSubtotal = decimal(amount);
  await expect(f.run('promo')).rejects.toMatchObject({ status: 422, response: { code: 'PROMOTION_INVALID' } });
});
test('validity start inclusive/end exclusive and minimum inclusive', async () => {
  const f = fixture(); f.promotion.minimumSubtotal = decimal('104000');
  const runAt = (now: Date) => new PricingService().validateCart(f.reader as unknown as PricingReader, 'u', 'promo', now);
  await expect(runAt(f.promotion.startsAt)).resolves.toBeDefined();
  await expect(runAt(f.promotion.endsAt)).rejects.toMatchObject({ status: 422 });
});
test('Decimal maximum exact, overflow rejected', async () => {
  const f = fixture(); f.cart.items[0].qty = 1; f.product.price = decimal('999999987999');
  expect((await f.run()).subtotal.toFixed(0)).toBe('999999999999'); f.cart.items[0].qty = 2; await expect(f.run()).rejects.toThrow();
});
test('fractional VND rejected rather than rounded', async () => { const f = fixture(); f.product.price = decimal('0.1'); await expect(f.run()).rejects.toThrow(); });
test('malformed configuration rejected', async () => { const f = fixture(); f.cart.items[0].configurationKey = 'bad'; await expect(f.run()).rejects.toThrow(); });
test('ownership and missing user rejected', async () => {
  const f = fixture(); f.cart.userId = 'other'; await expect(f.run()).rejects.toThrow();
  f.reader.user.findUnique.mockResolvedValue(null); await expect(f.run()).rejects.toThrow();
});
test('read-only engine works without any write delegates and leaves fixtures unchanged', async () => {
  const f = fixture(); const before = JSON.stringify({ cart: f.cart, product: f.product }); await f.run();
  expect(JSON.stringify({ cart: f.cart, product: f.product })).toBe(before);
});
test.each(['missing', 'inactive', 'not-started', 'expired', 'minimum'])('DB promotion policy rejects %s', async (kind) => {
  const f = fixture();
  if (kind === 'missing') f.reader.promotion.findUnique.mockResolvedValue(null);
  if (kind === 'inactive') f.promotion.isActive = false;
  if (kind === 'not-started') f.promotion.startsAt = new Date('2100-01-01');
  if (kind === 'expired') f.promotion.endsAt = new Date('2020-01-01');
  if (kind === 'minimum') f.promotion.minimumSubtotal = decimal('104001');
  await expect(f.run('promo')).rejects.toThrow();
});
test('duplicate configurations and duplicate toppings are malformed', async () => {
  const f = fixture(); f.cart.items.push({ ...f.cart.items[0], id: 'j' }); await expect(f.run()).rejects.toThrow();
  f.cart.items.pop(); f.cart.items[0].toppings.push({ toppingId: 't' }); await expect(f.run()).rejects.toThrow();
});

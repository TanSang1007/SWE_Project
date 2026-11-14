import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

type PricingProduct = Prisma.ProductGetPayload<{
  include: { sizes: true; toppings: { include: { topping: true } } };
}>;

// B10 supplies its transaction and JWT-derived identity. No transaction or write is started here.
export type PricingReader = Pick<Prisma.TransactionClient, 'user' | 'cart' | 'product' | 'promotion'>;
export interface ValidatedItem {
  cartItemId: string; productId: string; productName: string; size: string; qty: number;
  basePrice: Prisma.Decimal; sizeExtraPrice: Prisma.Decimal;
  toppings: { id: string; name: string; price: Prisma.Decimal }[];
  unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal;
}
const invalid = () => new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid cart or monetary bounds' });
const optionsInvalid = () => new BadRequestException({ code: 'INVALID_ITEM_OPTIONS', message: 'Options do not belong to product' });
const maxMoney = new Prisma.Decimal('999999999999');
const promotionInvalid = () => new UnprocessableEntityException({ code: 'PROMOTION_INVALID', message: 'Promotion is not applicable' });
function promotionMoney(value: Prisma.Decimal, positive = false) {
  if (!value.isFinite() || !value.isInteger() || value.isNegative() || value.gt(maxMoney) || (positive && value.isZero())) throw promotionInvalid();
  return value;
}
function money(value: Prisma.Decimal) {
  if (!value.isFinite() || !value.isInteger() || value.isNegative() || value.gt(maxMoney)) throw invalid();
  return value;
}

@Injectable()
export class PricingService {
  async validateCart(db: PricingReader, userId: string, promotionId?: string, now = new Date()) {
    if (!await db.user.findUnique({ where: { id: userId }, select: { id: true } })) throw new UnauthorizedException();
    const cart = await db.cart.findUnique({ where: { userId }, include: {
      items: { orderBy: { id: 'asc' }, include: { toppings: { orderBy: { toppingId: 'asc' } } } },
    } });
    if (!cart || cart.userId !== userId || cart.items.length < 1 || cart.items.length > 50) throw invalid();
    const products = await db.product.findMany({ where: { id: { in: [...new Set(cart.items.map((item) => item.productId))] } },
      include: { sizes: true, toppings: { include: { topping: true } } } });
    const byId = new Map(products.map((product) => [product.id, product]));
    const demand = new Map<string, { productId: string; qty: number; stock: number; version: number }>();
    const configurations = new Set<string>();
    let subtotal = new Prisma.Decimal(0);
    const items: ValidatedItem[] = cart.items.map((item) => {
      if (item.cartId !== cart.id || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99 || item.toppings.length > 10) throw invalid();
      const ids = item.toppings.map((entry) => entry.toppingId).sort();
      const key = [item.productId, item.size, ...ids].join(':');
      if (new Set(ids).size !== ids.length || item.configurationKey !== key || configurations.has(key)) throw invalid();
      configurations.add(key);
      const product = byId.get(item.productId);
      if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
      if (!product.isActive) throw new ConflictException({ code: 'PRODUCT_UNAVAILABLE', message: 'Product is no longer sold; adjust or remove the cart item' });
      if (!Number.isInteger(product.stock) || product.stock < 0 || product.stock > 2147483647) throw invalid();
      if (product.stock === 0) throw new ConflictException({ code: 'OUT_OF_STOCK', message: 'Product unavailable' });
      const price = this.calculateItemPrice(product, item.size, ids, item.qty);
      subtotal = money(subtotal.plus(price.lineTotal));
      const current = demand.get(product.id);
      demand.set(product.id, { productId: product.id, qty: (current?.qty ?? 0) + item.qty, stock: product.stock, version: product.version });
      return { cartItemId: item.id, productId: product.id, productName: product.name, size: item.size, qty: item.qty,
        ...price };
    });
    const stockRequirements = [...demand.values()].sort((a, b) => a.productId.localeCompare(b.productId));
    if (stockRequirements.some((entry) => entry.qty > entry.stock)) throw new ConflictException({ code: 'OUT_OF_STOCK', message: 'Product quantity exceeds current stock' });
    const configuredDiscount = await this.getConfiguredDiscount(db, promotionId, subtotal, now);
    const discountAmount = Prisma.Decimal.min(subtotal, configuredDiscount);
    const finalAmount = subtotal.minus(discountAmount);
    return { cartId: cart.id, items, stockRequirements, subtotal, configuredDiscount, discountAmount, finalAmount, currency: 'VND' as const };
  }

  // Compute one configured drink from catalog prices, without changing stock.
  private calculateItemPrice(product: PricingProduct, sizeName: string, toppingIds: string[], qty: number) {
    const size = product.sizes.find(entry => entry.productId === product.id && entry.size === sizeName);
    if (!size || !size.isActive || !['S', 'M', 'L'].includes(sizeName)) throw optionsInvalid();

    const toppings = toppingIds.map(id => {
      const relation = product.toppings.find(entry => entry.productId === product.id && entry.toppingId === id);
      if (!relation || relation.topping.id !== id || !relation.topping.isActive) throw optionsInvalid();
      return { id, name: relation.topping.name, price: money(relation.topping.price) };
    });
    const basePrice = money(product.price);
    const sizeExtraPrice = money(size.extraPrice);
    const unitPrice = money(toppings.reduce((sum, topping) => sum.plus(topping.price), basePrice.plus(sizeExtraPrice)));
    const lineTotal = money(unitPrice.times(qty));
    return { basePrice, sizeExtraPrice, toppings, unitPrice, lineTotal };
  }

  // The caller resolves the public promotion code; this checks its DB policy.
  private async getConfiguredDiscount(db: PricingReader, promotionId: string | undefined, subtotal: Prisma.Decimal, now: Date) {
    if (promotionId === undefined) return new Prisma.Decimal(0);

    const promotion = await db.promotion.findUnique({ where: { id: promotionId } });
    if (!promotion || !promotion.isActive || now < promotion.startsAt || now >= promotion.endsAt
      || subtotal.lt(promotionMoney(promotion.minimumSubtotal))) {
      throw promotionInvalid();
    }
    return promotionMoney(promotion.discountAmount, true);
  }

}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { AddCartItemDto } from './cart.dto';
import { assertNoActiveOrder, lockUser } from '../orders/order-policy';
const invalid = () => new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Cart bounds exceeded or invalid quantity/toppings' });
const maxMoney = new Prisma.Decimal('999999999999');
function money(value: Prisma.Decimal): string {
  if (value.isNegative() || value.greaterThan(maxMoney)) throw invalid();
  return value.toFixed(0);
}
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}
  get(userId: string) { return this.prisma.$transaction((tx) => this.read(tx, userId)); }
  private async read(tx: Prisma.TransactionClient, userId: string) {
    const rows = await tx.cartItem.findMany({ where: { cart: { userId } }, orderBy: { id: 'asc' }, include: {
      product: { include: { toppings: { select: { toppingId: true } } } }, productSize: true, toppings: { orderBy: { toppingId: 'asc' }, include: { topping: true } },
    } });
    let subtotal = new Prisma.Decimal(0); let totalQuantity = 0;
    const items = rows.map((row) => {
      const unitPrice = row.product.price.plus(row.productSize.extraPrice).plus(row.toppings.reduce((sum, entry) => sum.plus(entry.topping.price), new Prisma.Decimal(0)));
      const lineTotal = unitPrice.times(row.qty); subtotal = subtotal.plus(lineTotal); totalQuantity += row.qty;
      return { id: row.id, productId: row.productId, productName: row.product.name, imageUrl: row.product.imageUrl,
        available: row.product.isActive && row.product.stock > 0 && row.productSize.isActive && ['S', 'M', 'L'].includes(row.productSize.size)
          && row.toppings.every(t => t.topping.isActive && row.product.toppings.some(relation => relation.toppingId === t.toppingId)), size: row.size, qty: row.qty,
        toppings: row.toppings.map(({ topping }) => ({ id: topping.id, name: topping.name, price: money(topping.price) })),
        unitPrice: money(unitPrice), lineTotal: money(lineTotal) };
    });
    return { items, totalQuantity, subtotal: money(subtotal), currency: 'VND' as const };
  }
  private async lock(tx: Prisma.TransactionClient, userId: string) {
    // One local row lock serializes writes/merge for this user; no inventory lock/write.
    await lockUser(tx, userId);
    await assertNoActiveOrder(tx, userId);
  }
  private async validateOptions(tx: Prisma.TransactionClient, productId: string, size: string, toppingIds: string[]) {
    // Serialize validated Cart writes with lifecycle changes and full-product
    // deletion. Keep existing owner-lock order; never mutate stock/version.
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid FOR SHARE`;
    for (const id of [...toppingIds].sort()) await tx.$queryRaw`SELECT id FROM toppings WHERE id = ${id}::uuid FOR SHARE`;
    const product = await tx.product.findUnique({ where: { id: productId }, include: { sizes: true, toppings: { include: { topping: true } } } });
    if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
    if (!product.isActive) throw new ConflictException({ code: 'PRODUCT_UNAVAILABLE', message: 'Product is no longer sold; adjust or remove the cart item' });
    if (product.stock <= 0) throw new ConflictException({ code: 'OUT_OF_STOCK', message: 'Product unavailable' });
    if (!product.sizes.some((entry) => entry.size === size && entry.isActive) || toppingIds.some((id) => !product.toppings.some((entry) => entry.toppingId === id && entry.topping.isActive))) {
      throw new BadRequestException({ code: 'INVALID_ITEM_OPTIONS', message: 'Options do not belong to product' });
    }
  }
  add(userId: string, input: AddCartItemDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, userId);
      const productId = input.productId.toLowerCase(); const toppingIds = input.toppingIds.map((id) => id.toLowerCase()).sort();
      if (new Set(toppingIds).size !== toppingIds.length) throw invalid();
      await this.validateOptions(tx, productId, input.size, toppingIds);
      const cart = await tx.cart.upsert({ where: { userId }, create: { userId }, update: { updatedAt: new Date() } });
      const configurationKey = [productId, input.size, ...toppingIds].join(':');
      const existing = await tx.cartItem.findUnique({ where: { cartId_configurationKey: { cartId: cart.id, configurationKey } } });
      const qty = (existing?.qty ?? 0) + input.qty;
      if (qty > 99) throw invalid();
      if (existing) await tx.cartItem.update({ where: { id: existing.id }, data: { qty } });
      else {
        if (await tx.cartItem.count({ where: { cartId: cart.id } }) >= 50) throw invalid();
        await tx.cartItem.create({ data: { cartId: cart.id, productId, size: input.size, configurationKey, qty,
          toppings: { create: toppingIds.map((toppingId) => ({ toppingId })) } } });
      }
      return this.read(tx, userId); // Monetary overflow rolls back the write.
    });
  }
  private async owned(tx: Prisma.TransactionClient, userId: string, id: string) {
    const item = await tx.cartItem.findFirst({ where: { id, cart: { userId } }, include: { toppings: true } });
    if (!item) throw new NotFoundException({ code: 'CART_ITEM_NOT_FOUND', message: 'Cart item not found' });
    return item;
  }
  update(userId: string, id: string, qty: number) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, userId); const item = await this.owned(tx, userId, id);
      await this.validateOptions(tx, item.productId, item.size, item.toppings.map((t) => t.toppingId));
      await tx.cartItem.update({ where: { id: item.id }, data: { qty } });
      await tx.cart.update({ where: { id: item.cartId }, data: { updatedAt: new Date() } });
      return this.read(tx, userId);
    });
  }
  remove(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, userId); const item = await this.owned(tx, userId, id);
      await tx.cartItem.delete({ where: { id: item.id } });
      await tx.cart.update({ where: { id: item.cartId }, data: { updatedAt: new Date() } });
      return this.read(tx, userId);
    });
  }
}

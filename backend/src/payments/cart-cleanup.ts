import type { Prisma } from '../generated/prisma/client';

// Caller holds the owner lock and invokes this only at first successful settlement.
// All Cart writes are blocked while the order is PENDING/PAYMENT_FAILED.
export async function clearPurchasedCart(tx: Prisma.TransactionClient, userId: string) {
  await tx.cartItem.deleteMany({ where: { cart: { userId } } });
  await tx.cart.updateMany({ where: { userId }, data: { updatedAt: new Date() } });
}

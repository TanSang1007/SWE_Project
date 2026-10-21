import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
export async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}
export async function assertNoActiveOrder(tx: Prisma.TransactionClient, userId: string) {
  const order = await tx.order.findFirst({ where: { userId, status: { in: ['PENDING', 'PAYMENT_FAILED'] } }, select: { id: true } });
  if (order) throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Cancel the existing unpaid order before changing the cart or creating another order', details: { existingOrderId: order.id } });
}

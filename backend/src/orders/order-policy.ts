import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
export async function lockUser(tx: Prisma.TransactionClient, userId: string) {
<<<<<<< HEAD
  await tx.$queryRaw`SELECT id FROM users WHERE id::text = ${userId} FOR UPDATE`;
=======
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
>>>>>>> origin/main
}
export async function assertNoActiveOrder(tx: Prisma.TransactionClient, userId: string) {
  const order = await tx.order.findFirst({ where: { userId, status: { in: ['PENDING', 'PAYMENT_FAILED'] } }, select: { id: true } });
  if (order) throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Resolve the existing unpaid order before creating another order', details: { existingOrderId: order.id } });
}

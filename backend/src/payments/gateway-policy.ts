import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
export async function lockAttempts(tx: Prisma.TransactionClient, orderId: string) {
    await tx.$queryRaw `SELECT id FROM payment_attempts WHERE order_id=${orderId}::uuid ORDER BY id FOR UPDATE`;
}
export async function gatewayBlocks(tx: Prisma.TransactionClient, orderId: string) {
    const review = await tx.paymentAttempt.findFirst({ where: { orderId, applicationState: 'REVIEW' }, select: { id: true } });
    const pending = await tx.paymentAttempt.findFirst({ where: { orderId, OR: [{ applicationState: 'PENDING' }, { state: 'UNKNOWN' }] }, select: { id: true } });
    const receipt = await tx.paymentVerification.findFirst({ where: { attempt: { orderId }, state: 'VERIFIED', processedAt: null }, select: { id: true } });
    return { review: !!review, pending: !!pending, receipt: !!receipt };
}
export function assertGatewayClear(blocks: {
    review: boolean;
    pending: boolean;
    receipt: boolean;
}) {
    if (blocks.review)
        throw new ConflictException({ code: 'PAYMENT_REQUIRES_REVIEW', message: 'Payment requires review before another action' });
    if (blocks.pending || blocks.receipt)
        throw new ConflictException({ code: 'PAYMENT_PENDING', message: 'Payment outcome must be resolved before another action' });
}

import { randomUUID, createHash } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';
// Isolated synthetic cutover fixtures only. Never edits an existing journal or
// exposes a grant API; this represents the actual balance in a pre-L01 database.
export async function openingFixture(db: PrismaClient, userId: string, points: number) {
    if (await db.loyaltyEntry.count({ where: { userId } }))
        throw Error('Opening requires a fresh legacy fixture');
    await db.user.update({ where: { id: userId }, data: { loyaltyPoints: points } });
    await db.loyaltyEntry.create({ data: { userId, kind: 'OPENING', points, availableDelta: points, reservedDelta: 0, debtDelta: 0n, effectKey: `OPENING:${userId}` } });
}
export async function legacyAwardFixture(db: PrismaClient, orderId: string, points: number) {
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    if (o.status !== 'PENDING' || o.redeemedPoints !== 0 || await db.loyaltyAward.count({ where: { orderId } }))
        throw Error('Fresh pre-payment legacy fixture required');
    await db.order.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: new Date(), version: { increment: 1 } } });
    await db.loyaltyAward.create({ data: { orderId, userId: o.userId, points, createdAt: new Date('2020-01-01T00:00:00Z') } });
    const key = randomUUID();
    const hash = createHash('sha256').update(JSON.stringify({ orderId, method: 'WALLET' })).digest('hex');
    const claim = await db.idempotencyRequest.create({ data: { userId: o.userId, operation: 'PAY_ORDER', idempotencyKey: key, requestHash: hash, state: 'COMPLETED', orderId, responseStatus: 200, responseBody: { legacy: true }, completedAt: new Date() } });
    await db.payment.create({ data: { orderId, userId: o.userId, idempotencyKey: key, idempotencyRequestId: claim.id, amount: o.total, method: 'WALLET', status: 'SUCCEEDED' } });
    await openingFixture(db, o.userId, points);
}

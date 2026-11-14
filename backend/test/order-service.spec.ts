import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { OrderService } from '../src/orders/order.service';
import { PricingService } from '../src/pricing/pricing.service';

test.each([null, new Date('2026-10-01T00:11:00Z')])('timeout with unresolved gateway returns its persisted expiry marker %p without releasing reservations', async previousMarker => {
  const userId = randomUUID(); const id = randomUUID();
  const row = { id, userId, orderCode: 'BL-fixture', status: 'PENDING', currency: 'VND', items: [], payments: [], loyaltyAward: null,
    subtotal: new Prisma.Decimal('50000'), discountAmount: new Prisma.Decimal('0'), total: new Prisma.Decimal('50000'),
    promotionCodeSnapshot: null, redeemedPoints: 0, loyaltyDiscountAmount: new Prisma.Decimal('0'), redemptionState: 'NONE', version: 0,
    createdAt: new Date('2026-10-01T00:00:00Z'), paidAt: null, paymentStartedAt: new Date('2026-10-01T00:00:00Z'),
    paymentExpiresAt: new Date('2026-10-01T00:10:00Z'), paymentExpiredAt: previousMarker, cancellationReason: null };
  const tx = { $executeRaw: jest.fn().mockResolvedValue(0), $queryRaw: jest.fn().mockResolvedValue([{ id }]),
    order: { findFirst: jest.fn().mockResolvedValue(row),
      update: jest.fn((input: { data: { paymentExpiredAt: Date } }) => Promise.resolve(input)), updateMany: jest.fn() },
    paymentAttempt: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: randomUUID() }) },
    paymentVerification: { findFirst: jest.fn().mockResolvedValue(null) }, product: { updateMany: jest.fn() },
    user: { updateMany: jest.fn() }, loyaltyEntry: { create: jest.fn() } };
  const db = { $transaction: jest.fn().mockImplementation((work: (transaction: typeof tx) => Promise<unknown>) => work(tx)) };
  const service = new OrderService(db as unknown as PrismaService, {} as PricingService, new ConfigService());
  const result = await service.cancel(userId, id, true);
  const saved = previousMarker ?? tx.order.update.mock.calls[0][0].data.paymentExpiredAt;
  expect(result).toMatchObject({ id, status: 'PENDING', paymentExpiredAt: saved.toISOString(), cancellationReason: null });
  expect(tx.order.update).toHaveBeenCalledTimes(previousMarker ? 0 : 1);
  expect(tx.order.updateMany).not.toHaveBeenCalled(); expect(tx.product.updateMany).not.toHaveBeenCalled();
  expect(tx.user.updateMany).not.toHaveBeenCalled(); expect(tx.loyaltyEntry.create).not.toHaveBeenCalled();
});

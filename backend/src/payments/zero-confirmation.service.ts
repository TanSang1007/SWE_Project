import { assertPaymentWindow } from './payment-deadline';
import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { requireIdempotencyKey, replayResult } from '../common/idempotency';
import { lockUser } from '../orders/order-policy';
import { effect, lockOrder, persistEffects, reconcileAccount, reservationGate, type Effect } from '../loyalty/loyalty-accounting';
import { assertGatewayClear, gatewayBlocks, lockAttempts } from './gateway-policy';

const unavailable = () => new ServiceUnavailableException({ code: 'PAYMENT_UNAVAILABLE', message: 'Confirmation was not committed; retry the same request' });
const invalidState = () => new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Order does not permit zero-total confirmation' });
const include = { items: { include: { toppings: true } }, payments: true, loyaltyAward: true };
type Order = Prisma.OrderGetPayload<{ include: typeof include }>;

// Validate stored arithmetic, never reprice against today's catalog/promotion.
export function validateZeroSnapshot(o: Order) {
  if (!o.total.isZero()) throw new UnprocessableEntityException({ code: 'PAYMENT_AMOUNT_UNSUPPORTED', message: 'Internal confirmation requires exactly zero VND' });
  if ([o.subtotal, o.discountAmount, o.loyaltyDiscountAmount].some(n => !n.isFinite() || !n.isInteger())
    || !o.items.length || o.subtotal.isNegative() || o.discountAmount.isNegative() || o.discountAmount.gt(o.subtotal)
    || o.loyaltyDiscountAmount.isNegative() || !Number.isInteger(o.redeemedPoints) || o.redeemedPoints < 0
    || !o.loyaltyDiscountAmount.equals(new Prisma.Decimal(o.redeemedPoints).times(100))
    || !o.total.equals(o.subtotal.minus(o.discountAmount).minus(o.loyaltyDiscountAmount))) throw unavailable();
  let subtotal = new Prisma.Decimal(0);
  for (const item of o.items) {
    const topping = item.toppings.reduce((sum, t) => sum.plus(t.priceSnapshot), new Prisma.Decimal(0));
    if ([item.basePrice, item.sizeExtraPrice, item.unitPrice, item.lineTotal, ...item.toppings.map(t => t.priceSnapshot)].some(n => !n.isFinite() || !n.isInteger())
      || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99 || item.basePrice.isNegative() || item.sizeExtraPrice.isNegative()
      || item.toppings.some(t => t.priceSnapshot.isNegative()) || !item.unitPrice.equals(item.basePrice.plus(item.sizeExtraPrice).plus(topping))
      || !item.lineTotal.equals(item.unitPrice.times(item.qty))) throw unavailable();
    subtotal = subtotal.plus(item.lineTotal);
  }
  if (!subtotal.equals(o.subtotal)) throw unavailable();
  if (o.redeemedPoints > 0 ? o.redemptionState !== 'RESERVED' || o.reservationCycle !== 1
    : o.redemptionState !== 'NONE' || o.reservationCycle !== 0) throw unavailable();
}

@Injectable()
export class ZeroConfirmationService {
  constructor(private readonly db: PrismaService) {}
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('lock_timeout','200ms',true),set_config('statement_timeout','300ms',true),set_config('TimeZone','UTC',true)`;
      return work(tx);
    }, this.db.transactionOptions ?? { maxWait: 50, timeout: 400 });
  }
  async confirm(userId: string, key: string | undefined, orderId: string) {
    requireIdempotencyKey(key);
    const hash = createHash('sha256').update(JSON.stringify({ action: 'ZERO_COMPLETE_V1', orderId })).digest('hex');
    const where = { userId_operation_idempotencyKey: { userId, operation: 'PAY_ORDER' as const, idempotencyKey: key } };
    try {
      return await this.transaction(async tx => {
        // Ownership is checked before historical replay, including recovery reads.
        if (!await tx.order.findFirst({ where: { id: orderId, userId }, select: { id: true } }))
          throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
        await lockUser(tx, userId);
        await lockOrder(tx, orderId);
        const o = await tx.order.findFirstOrThrow({ where: { id: orderId, userId }, include });
        const previous = await tx.idempotencyRequest.findUnique({ where });
        if (previous) return replayResult(previous, hash);
        await lockAttempts(tx, orderId);
        await tx.$queryRaw`SELECT v.id FROM payment_verifications v JOIN payment_attempts a ON a.id=v.attempt_id WHERE a.order_id=${orderId}::uuid ORDER BY v.id FOR UPDATE OF v`;
        assertGatewayClear(await gatewayBlocks(tx, orderId));
        // A zero order cannot legitimately have any gateway history: do not bridge
        // historical terminal gateway attempts into an internal confirmation.
        if (await tx.paymentAttempt.findFirst({ where: { orderId }, select: { id: true } })) throw invalidState();
        if (['PAID', 'PREPARING', 'READY', 'COMPLETED'].includes(o.status) || o.payments.some(p => p.status === 'SUCCEEDED'))
          throw new ConflictException({ code: 'ORDER_ALREADY_PAID', message: 'Order already confirmed' });
        if (o.status !== 'PENDING' || o.paidAt || o.payments.length || o.loyaltyAward) throw invalidState();
        assertPaymentWindow(o);
        validateZeroSnapshot(o);
        if (o.version >= 2147483647) throw unavailable();
        const before = await reconcileAccount(tx, userId), account = { ...before };
        reservationGate(account, o.redeemedPoints);
        const claim = await tx.idempotencyRequest.create({ data: { userId, operation: 'PAY_ORDER', idempotencyKey: key, requestHash: hash, state: 'PROCESSING' } });
        const now = new Date();
        const changed = await tx.order.updateMany({ where: { id: orderId, userId, status: 'PENDING', version: o.version }, data: {
          status: 'PAID', paidAt: now, redemptionState: o.redeemedPoints > 0 ? 'SETTLED' : 'NONE', version: { increment: 1 }, updatedAt: now } });
        if (changed.count !== 1) throw new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Read the current order and retry the same key' });
        const payment = await tx.payment.create({ data: { orderId, userId, idempotencyRequestId: claim.id, idempotencyKey: key, amount: o.total,
          provider: 'INTERNAL_ZERO', method: 'ZERO_TOTAL', status: 'SUCCEEDED', confirmedAt: now } });
        const effects: Effect[] = [];
        if (o.redeemedPoints > 0) effects.push(effect(account, 'SETTLE', o.redeemedPoints, { orderId, paymentId: payment.id, cycle: o.reservationCycle }));
        await tx.loyaltyAward.create({ data: { orderId, userId, points: 0 } });
        effects.push(effect(account, 'EARN', 0, { orderId, paymentId: payment.id }));
        await persistEffects(tx, before, account, effects);
        const body = { payment: { id: payment.id, orderId, provider: payment.provider, status: payment.status, amount: '0', method: payment.method },
          order: { id: orderId, orderCode: o.orderCode, status: 'PAID' }, loyalty: { awardedPoints: 0, redeemedPoints: o.redeemedPoints,
            redemptionState: o.redeemedPoints > 0 ? 'SETTLED' : 'NONE', debtOffsetPoints: 0, availablePointsAdded: 0 }, cashRefundStatus: 'NOT_APPLICABLE' };
        await tx.idempotencyRequest.update({ where: { id: claim.id }, data: { state: 'COMPLETED', orderId, responseStatus: 200, responseBody: body, completedAt: now } });
        return { body, replayed: false };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Read after rollback only. Never repeat financial writes automatically.
      try {
        const previous = await this.transaction(async tx => {
          if (!await tx.order.findFirst({ where: { id: orderId, userId }, select: { id: true } }))
            throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
          return tx.idempotencyRequest.findUnique({ where });
        });
        if (previous) return replayResult(previous, hash);
      } catch (recovery) { if (recovery instanceof HttpException) throw recovery; }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
        const state = typeof error.meta?.code === 'string' ? error.meta.code : adapter?.cause?.originalCode;
        if (['P2002', 'P2028', 'P2034'].includes(error.code) || ['55P03', '57014', '40P01', '40001'].includes(state ?? ''))
          throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Retry the same key later' });
      }
      throw unavailable();
    }
  }
}

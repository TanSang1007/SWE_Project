import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { lockUser } from '../orders/order-policy';
import type { PaymentDto } from './payment.dto';
import { MockPaymentService } from './mock-payment.service';
import { requireIdempotencyKey, replayResult } from '../common/idempotency';
import { assertTransition } from '../orders/order-state';
import { effect, lockOrder, persistEffects, reconcileAccount, reservationGate, type Effect } from '../loyalty/loyalty-accounting';
import { ConfigService } from '@nestjs/config';
import { assertPaymentWindow } from './payment-deadline';
import { lockAttempts } from './gateway-policy';
const maxInt = 2147483647;
const conflict = () => new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Data changed; read the current order and try again' });
const unavailable = () => new ServiceUnavailableException({ code: 'PAYMENT_UNAVAILABLE', message: 'Payment result was not committed; retry the same request' });
const include = { items: { include: { toppings: true } } };
type Order = Prisma.OrderGetPayload<{ include: typeof include }>;
@Injectable()
export class PaymentService {
  constructor(private readonly db: PrismaService, private readonly mock: MockPaymentService, private readonly config: ConfigService = new ConfigService()) {}
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', '200ms', true), set_config('statement_timeout', '300ms', true), set_config('TimeZone', 'UTC', true)`;
      return work(tx);
    }, this.db.transactionOptions ?? { maxWait: 50, timeout: 400 });
  }
  private async transition(tx: Prisma.TransactionClient, order: Order, status: 'PENDING' | 'PAID' | 'PAYMENT_FAILED') {
    assertTransition(order.status, status);
    if (order.version >= maxInt) throw unavailable();
    const now = new Date();
    const changed = await tx.order.updateMany({ where: { id: order.id, userId: order.userId, status: order.status, version: order.version },
      data: { status, redemptionState: order.redeemedPoints === 0 ? 'NONE' : status === 'PENDING' ? 'RESERVED' : status === 'PAID' ? 'SETTLED' : 'RELEASED', reservationCycle: order.reservationCycle, version: { increment: 1 }, updatedAt: now, ...(status === 'PAID' ? { paidAt: now } : {}) } });
    if (changed.count !== 1) throw conflict();
    order.status = status; order.redemptionState = order.redeemedPoints === 0 ? 'NONE' : status === 'PENDING' ? 'RESERVED' : status === 'PAID' ? 'SETTLED' : 'RELEASED'; order.version++;
  }
  private readStock(tx: Prisma.TransactionClient, id: string) { return tx.product.findUniqueOrThrow({ where: { id } }); }
  private async stock(tx: Prisma.TransactionClient, order: Order, restore: boolean) {
    const demand = new Map<string, number>();
    for (const item of order.items) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.qty);
    for (const [id, qty] of [...demand].sort(([a], [b]) => a.localeCompare(b))) {
      const product = await this.readStock(tx, id);
      if (!restore && product.stock < qty) throw new ConflictException({ code: 'OUT_OF_STOCK', message: 'Insufficient stock for payment retry' });
      if (product.version >= maxInt || (restore && product.stock > maxInt - qty)) throw unavailable();
      const changed = await tx.product.updateMany({ where: { id, version: product.version, ...(restore ? {} : { stock: { gte: qty } }) },
        data: { stock: restore ? { increment: qty } : { decrement: qty }, version: { increment: 1 }, updatedAt: new Date() } });
      if (changed.count !== 1) throw conflict();
    }
  }
  async pay(userId: string, key: string | undefined, input: PaymentDto) {
    requireIdempotencyKey(key);
    if ((this.config.get<string>('PAYMENT_PROVIDER_MODE') ?? 'MOCK') !== 'MOCK') {
      throw new ForbiddenException({ code: 'PAYMENT_PROVIDER_DISABLED', message: 'Mock payment is disabled in this provider mode' });
    }
    const hash = createHash('sha256').update(JSON.stringify({ orderId: input.orderId, method: input.method })).digest('hex');
    const where = { userId_operation_idempotencyKey: { userId, operation: 'PAY_ORDER' as const, idempotencyKey: key } };
    try {
      return await this.transaction(async (tx) => {
        let order = await tx.order.findFirst({ where: { id: input.orderId, userId }, include });
        if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
        const previous = await tx.idempotencyRequest.findUnique({ where });
        if (previous) return replayResult(previous, hash);
        // Same serialization as Cart/create/cancel; lock before FK claim insertion.
        await lockUser(tx, userId);
        const completed = await tx.idempotencyRequest.findUnique({ where });
        if (completed) return replayResult(completed, hash);
        await lockOrder(tx, input.orderId);
        order = await tx.order.findFirstOrThrow({ where: { id: input.orderId, userId }, include });
        await lockAttempts(tx, order.id);
        if (await tx.paymentAttempt.findFirst({ where: { orderId: order.id }, select: { id: true } })) {
          throw new ConflictException({ code: 'PAYMENT_REQUIRES_REVIEW', message: 'Gateway orders cannot use Mock payment' });
        }
        if (['PAID', 'PREPARING', 'READY', 'COMPLETED'].includes(order.status)) throw new ConflictException({ code: 'ORDER_ALREADY_PAID', message: 'Read the current order; payment already succeeded' });
        if (!['PENDING', 'PAYMENT_FAILED'].includes(order.status)) throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Order does not allow payment' });
        assertPaymentWindow(order);
        const account = await reconcileAccount(tx, userId); const before = { ...account };
        reservationGate(account, order.redeemedPoints);
        if (order.redeemedPoints > 0 && order.status === 'PAYMENT_FAILED' && account.available < BigInt(order.redeemedPoints)) {
          throw new ConflictException({ code: 'LOYALTY_INSUFFICIENT_POINTS', message: 'Insufficient points for the original reservation' });
        }
        const effects: Effect[] = []; const paymentId = randomUUID();
        const claim = await tx.idempotencyRequest.create({ data: { userId, operation: 'PAY_ORDER', idempotencyKey: key, requestHash: hash, state: 'PROCESSING' } });
        if (order.status === 'PAYMENT_FAILED') {
          if (order.redeemedPoints > 0) {
            if (order.reservationCycle >= maxInt) throw unavailable();
            order.reservationCycle++;
            effects.push(effect(account, 'RESERVE', order.redeemedPoints, { orderId: order.id, paymentId, cycle: order.reservationCycle }));
          }
          await this.stock(tx, order, false); await this.transition(tx, order, 'PENDING');
        }
        const success = this.mock.result() === 'SUCCESS';
        await this.transition(tx, order, success ? 'PAID' : 'PAYMENT_FAILED');
        const payment = await tx.payment.create({ data: { id: paymentId, orderId: order.id, userId, idempotencyRequestId: claim.id, idempotencyKey: key,
          amount: order.total, method: input.method, status: success ? 'SUCCEEDED' : 'FAILED', failureCode: success ? null : 'MOCK_DECLINED' } });
        let awardedPoints = 0; let credit: Effect | undefined;
        if (order.redeemedPoints > 0) {
          const redemption = effect(account, success ? 'SETTLE' : 'RELEASE', order.redeemedPoints, { orderId: order.id, paymentId, cycle: order.reservationCycle });
          effects.push(redemption); if (!success) credit = redemption;
        }
        if (success) {
          const points = order.total.dividedBy(10000).floor();
          if (!points.isFinite() || points.isNegative() || points.gt(maxInt)) throw unavailable();
          awardedPoints = points.toNumber(); // Exact integer within PostgreSQL INTEGER bounds.
          await tx.loyaltyAward.create({ data: { orderId: order.id, userId, points: awardedPoints } });
          credit = effect(account, 'EARN', awardedPoints, { orderId: order.id, paymentId }); effects.push(credit);
        } else await this.stock(tx, order, true);
        if (effects.length) await persistEffects(tx, before, account, effects);
        const body = { payment: { id: payment.id, orderId: order.id, status: payment.status, amount: payment.amount.toFixed(0), method: payment.method,
          ...(payment.failureCode ? { failureCode: payment.failureCode } : {}) },
          order: { id: order.id, orderCode: order.orderCode, status: order.status }, loyalty: { awardedPoints, redeemedPoints: order.redeemedPoints, redemptionState: order.redemptionState,
            debtOffsetPoints: credit ? Number(-credit.debtDelta) : 0, availablePointsAdded: credit?.availableDelta ?? 0 } };
        await tx.idempotencyRequest.update({ where: { id: claim.id }, data: { state: 'COMPLETED', orderId: order.id, responseStatus: 200, responseBody: body, completedAt: new Date() } });
        return { body, replayed: false };
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw unavailable();
      if (error instanceof HttpException) throw error;
      // Recovery is a read after rollback, never an automatic business retry.
      try { const previous = await this.transaction((tx) => tx.idempotencyRequest.findUnique({ where }));
        if (previous) return replayResult(previous, hash);
      } catch (recovery) { if (recovery instanceof HttpException) throw recovery; }
      const adapter = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined : undefined;
      const sqlState = error instanceof Prisma.PrismaClientKnownRequestError && typeof error.meta?.code === 'string' ? error.meta.code : adapter?.cause?.originalCode ?? '';
      if (error instanceof Prisma.PrismaClientKnownRequestError && (['P2002', 'P2028', 'P2034'].includes(error.code)
        || ['55P03', '57014', '40P01', '40001'].includes(sqlState))) {
        throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Retry the same key later' });
      }
      throw unavailable();
    }
  }
}

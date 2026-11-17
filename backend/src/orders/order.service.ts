import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma, type OrderStatus, type UserRole } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import type { CreateOrderDto, OrderItemDto } from './order.dto';
import { assertNoActiveOrder, lockUser } from './order-policy';
import { requireIdempotencyKey, replayResult } from '../common/idempotency';
import { assertTransition } from './order-state';
import { effect, lockOrder, persistEffects, reconcileAccount, validateRedemption } from '../loyalty/loyalty-accounting';
import { gatewayBlocks, lockAttempts } from '../payments/gateway-policy';
import { assertVnpayMinimum, effectivePaymentProvider } from '../payments/minimum-payment-policy';
import { assertPaymentAdmission } from '../payments/payment-admission';
import { PAYMENT_WINDOW_MS } from '../payments/payment-deadline';
import { customerOrderCode, customerOrderCodes } from './customer-order-code';
import { assertPaidCancellation, cancellationWindow } from './cancellation-window';
import type { RefundUpdateDto, SupportReviewDto } from './order-aftercare.dto';
import { changeOrderIngredients, reserveOrderIngredients } from '../ingredients/order-ingredients';

export function normalizeItems(items: OrderItemDto[]) {
  if (!Array.isArray(items) || items.length === 0) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Cart must not be empty' });
  const map = new Map<string, OrderItemDto>();
  for (const item of items) {
    // Internal service callers also pass through normalization, without a DTO pipe.
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid quantity' });
    const toppingIds = [...item.toppingIds].sort();
    if (new Set(toppingIds).size !== toppingIds.length) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Duplicate toppings' });
    const key = [item.productId, item.size, ...toppingIds].join(':');
    const qty = (map.get(key)?.qty ?? 0) + item.qty;
    if (qty > 99) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Merged quantity exceeds bounds' });
    map.set(key, { productId: item.productId, size: item.size, toppingIds, qty });
    if (map.size > 50) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Too many configurations' });
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
}
const conflict = () => new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Data changed; reload and confirm again' });
const workflowUnavailable = () => new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Order workflow could not be committed' });
function isConcurrencyError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
  const sqlState = typeof error.meta?.code === 'string' ? error.meta.code : adapter?.cause?.originalCode ?? '';
  return ['P2028', 'P2034'].includes(error.code) || ['55P03', '57014', '40P01', '40001'].includes(sqlState);
}
const include = { items: { orderBy: { id: 'asc' as const }, include: { toppings: { orderBy: { toppingId: 'asc' as const } } } },
  loyaltyAward: true, payments: { orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }], take: 1 } };
type OrderRow = Prisma.OrderGetPayload<{ include: typeof include }>;
const staffActive: OrderStatus[] = ['PAID', 'PREPARING', 'READY'];
const staffReadable: OrderStatus[] = [...staffActive, 'COMPLETED'];
function operatorScope(role: UserRole, status?: OrderStatus): Prisma.OrderWhereInput {
  if (role === 'ADMIN') return status === undefined ? {} : { status };
  if (role !== 'STAFF' || (status !== undefined && !staffReadable.includes(status))) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission for this action' });
  }
  return { status: status ?? { in: staffActive } };
}
function earnedPoints(order: { status: OrderRow['status']; loyaltyAward: { points: number; reversedAt: Date | null } | null }) {
  return order.status === 'CANCELLED' ? 0 : order.loyaltyAward?.reversedAt ? 0 : order.loyaltyAward?.points ?? null;
}
function response(order: OrderRow, customerCode: string) {
  return { id: order.id, orderCode: order.orderCode, customerOrderCode: customerCode, status: order.status, currency: 'VND',
    items: order.items.map((item) => ({ productId: item.productId, productName: item.productNameSnapshot, size: item.size, qty: item.qty,
      unitPrice: item.unitPrice.toFixed(0), lineTotal: item.lineTotal.toFixed(0),
      toppings: item.toppings.map((t) => ({ name: t.toppingNameSnapshot, price: t.priceSnapshot.toFixed(0) })) })),
    subtotal: order.subtotal.toFixed(0), discountAmount: order.discountAmount.toFixed(0), total: order.total.toFixed(0),
    promotionCode: order.promotionCodeSnapshot, createdAt: order.createdAt.toISOString(),
    paymentStartedAt: order.paymentStartedAt?.toISOString() ?? null, expiresAt: order.paymentExpiresAt?.toISOString() ?? null,
    paymentExpiredAt: order.paymentExpiredAt?.toISOString() ?? null, cancellationReason: order.cancellationReason ?? null, serverNow: new Date().toISOString(),
    redeemedPoints: order.redeemedPoints, loyaltyDiscountAmount: order.loyaltyDiscountAmount.toFixed(0),
    redemptionState: order.redemptionState, estimatedEarnedPoints: order.total.dividedBy(10000).floor().toNumber() };
}
function detail(order: OrderRow, customerCode: string) {
  return { ...response(order, customerCode), paidAt: order.paidAt?.toISOString() ?? null,
    earnedPoints: earnedPoints(order),
    paymentStatus: order.payments[0]?.status ?? null };
}

@Injectable()
export class OrderService {
  constructor(private readonly db: PrismaService, private readonly pricing: PricingService, private readonly config: ConfigService) {}
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await (this.db.transactionOptions?.timeout === 5000 ? tx.$executeRaw`SELECT set_config('lock_timeout', '2000ms', true), set_config('statement_timeout', '4000ms', true), set_config('TimeZone', 'UTC', true)` : tx.$executeRaw`SELECT set_config('lock_timeout', '5000ms', true), set_config('statement_timeout', '8000ms', true), set_config('TimeZone', 'UTC', true)`);
      return work(tx);
    }, this.db.transactionOptions ?? { maxWait: 5000, timeout: 10000 });
  }
  async create(userId: string, key: string | undefined, input: CreateOrderDto) {
    requireIdempotencyKey(key);
    const items = normalizeItems(input.items);
    const hash = createHash('sha256').update(JSON.stringify({ items, promotionCode: input.promotionCode ?? null, ...((input.redeemedPoints ?? 0) > 0 ? { redeemedPoints: input.redeemedPoints } : {}) })).digest('hex');
    const where = { userId_operation_idempotencyKey: { userId, operation: 'CREATE_ORDER' as const, idempotencyKey: key } };
    try {
      return await this.transaction(async (tx) => {
        const previous = await tx.idempotencyRequest.findUnique({ where });
        if (previous) return replayResult(previous, hash);
        // Lock before inserting FK-bearing claims to avoid lock-upgrade deadlocks
        // between different keys of the same user (FK checks take KEY SHARE).
        await lockUser(tx, userId);
        const completed = await tx.idempotencyRequest.findUnique({ where });
        if (completed) return replayResult(completed, hash);
        const claim = await tx.idempotencyRequest.create({ data: { userId, operation: 'CREATE_ORDER', idempotencyKey: key, requestHash: hash, state: 'PROCESSING' } });
        await assertNoActiveOrder(tx, userId);
        const { priced, promotion } = await this.priceSelection(tx, userId, input);
        const account = await reconcileAccount(tx, userId); const before = { ...account };
        const r = input.redeemedPoints ?? 0;
        const loyalty = validateRedemption(account, r, priced.finalAmount);
        effectivePaymentProvider(this.config);
        assertVnpayMinimum(loyalty.total);
        if (loyalty.total.gt(0)) assertPaymentAdmission(this.config);
        const [{ id }] = await tx.$queryRaw<{ id: string }[]>`SELECT nextval('orders_id_seq')::text AS id`;
        const effects = r > 0 ? [effect(account, 'RESERVE', r, { orderId: id, cycle: 1 })] : [];
        for (const demand of priced.stockRequirements) {
          if (demand.version >= 2147483647) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Stock version bounds exceeded' });
          // Serialize catalog changes without decrementing a fictional drink stock.
          const updated = await tx.product.updateMany({ where: { id: demand.productId, version: demand.version, isActive:true },
            data: { version: { increment: 1 }, updatedAt: new Date() } });
          if (updated.count !== 1) throw conflict();
        }
        // VNPAY timestamps have whole-second precision; retain exactly 600s.
        const startedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
        await tx.order.create({ data: { id, orderCode: `BL${id.padStart(3, '0')}`, userId, status: 'PENDING',
          paymentStartedAt: startedAt, paymentExpiresAt: new Date(startedAt.getTime() + PAYMENT_WINDOW_MS),
          subtotal: priced.subtotal, discountAmount: priced.discountAmount, total: loyalty.total, redeemedPoints: r, loyaltyDiscountAmount: loyalty.discount,
          redemptionState: r > 0 ? 'RESERVED' : 'NONE', reservationCycle: r > 0 ? 1 : 0,
          promotionId: promotion?.id ?? null, promotionCodeSnapshot: promotion?.code ?? null } });
        // Bulk snapshots avoid a nested write for every configuration/topping.
        // Await each parent batch before its children on this same transaction.
        const itemIds = await tx.$queryRaw<{ id: string }[]>`SELECT nextval('order_items_id_seq')::text AS id FROM generate_series(1, ${priced.items.length}::integer)`;
        const snapshots = priced.items.map((item, idx) => ({ id: itemIds[idx].id, item }));
        await tx.orderItem.createMany({ data: snapshots.map(({ id: itemId, item }) => ({ id: itemId, orderId: id,
          productId: item.productId, productNameSnapshot: item.productName, size: item.size,
          basePrice: item.basePrice, sizeExtraPrice: item.sizeExtraPrice, unitPrice: item.unitPrice, qty: item.qty, lineTotal: item.lineTotal,
          ingredientKeysSnapshot:item.ingredientKeysSnapshot })) });
        await reserveOrderIngredients(tx,id,priced.ingredientRequirements,userId);
        const toppings = snapshots.flatMap(({ id: itemId, item }) => item.toppings.map(t => ({ orderItemId: itemId,
          toppingId: t.id, toppingNameSnapshot: t.name, priceSnapshot: t.price })));
        if (toppings.length) await tx.orderItemTopping.createMany({ data: toppings });
        const order = await tx.order.findUniqueOrThrow({ where: { id }, include });
        if (effects.length) await persistEffects(tx, before, account, effects);
        // Keep the Cart intact: a PENDING order is not a successful payment.
        // Cart writes stay locked until this order succeeds or is cancelled.
        const body = response(order, await customerOrderCode(tx, id, order.orderCode));
        await tx.idempotencyRequest.update({ where: { id: claim.id }, data: { state: 'COMPLETED', orderId: id,
          responseStatus: 201, responseBody: body, completedAt: new Date() } });
        return { body, replayed: false };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // The original transaction has rolled back before this single recovery read.
      try { const previous = await this.transaction((tx) => tx.idempotencyRequest.findUnique({ where }));
        if (previous) return replayResult(previous, hash);
      } catch (recovery) { if (recovery instanceof HttpException) throw recovery; }
      if (isConcurrencyError(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Retry the same key later' });
      }
      throw new ServiceUnavailableException();
    }
  }
  private async priceSelection(tx: Prisma.TransactionClient, userId: string, input: CreateOrderDto) {
    const items = normalizeItems(input.items);
    const cart = await tx.cart.findUnique({ where: { userId }, include: { items: { include: { toppings: true } } } });
    if (!cart || !cart.items.length) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Cart must not be empty' });
    const current = normalizeItems(cart.items.map(item => ({ productId: item.productId, size: item.size, qty: item.qty, toppingIds: item.toppings.map(t => t.toppingId) })));
    if (JSON.stringify(items) !== JSON.stringify(current)) throw conflict();
    const promotion = input.promotionCode === undefined ? null : await tx.promotion.findUnique({ where: { code: input.promotionCode } });
    if (input.promotionCode !== undefined && !promotion) throw new UnprocessableEntityException({ code: 'PROMOTION_INVALID', message: 'Promotion not found' });
    const priced = await this.pricing.validateCart(tx, userId, promotion?.id);
    return { priced, promotion };
  }
  async preview(userId: string, input: CreateOrderDto) {
    try {
      return await this.db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await assertNoActiveOrder(tx, userId);
        const { priced, promotion } = await this.priceSelection(tx, userId, input);
        const account = await reconcileAccount(tx, userId); const r = input.redeemedPoints ?? 0;
        const loyalty = validateRedemption(account, r, priced.finalAmount);
        const cap = account.debt > 0n ? 0 : Math.min(Number(account.available), 2147483647, priced.finalAmount.dividedBy(100).floor().toNumber());
        return { currency: 'VND', itemSubtotal: priced.subtotal.toFixed(0), promotionCode: promotion?.code ?? null,
          promotionDiscount: priced.discountAmount.toFixed(0), totalAfterPromotion: priced.finalAmount.toFixed(0),
          redeemedPoints: r, pointValueVnd: '100', loyaltyDiscount: loyalty.discount.toFixed(0), finalTotal: loyalty.total.toFixed(0),
          earnedPoints: loyalty.total.dividedBy(10000).floor().toNumber(), availablePoints: Number(account.available),
          availablePointsAfterReservation: Number(account.available)-r, reservedPoints: Number(account.reserved),
          outstandingReversalPoints: account.debt.toString(), maxRedeemablePoints: cap };
      }, { isolationLevel: 'RepeatableRead', ...(this.db.transactionOptions ?? { maxWait: 50, timeout: 400 }) });
    } catch (error) { if (error instanceof HttpException) throw error; throw workflowUnavailable(); }
  }
  async get(userId: string, id: string) {
    try {
      const order = await this.db.order.findFirst({ where: { id, userId }, include });
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      return detail(order, await customerOrderCode(this.db, order.id, order.orderCode));
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException(); }
  }
  async active(userId: string) {
    try {
      const order = await this.db.order.findFirst({ where: { userId, status: { in: ['PENDING', 'PAYMENT_FAILED'] } }, include });
      return { order: order ? detail(order, await customerOrderCode(this.db, order.id, order.orderCode)) : null, serverNow: new Date().toISOString() };
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException(); }
  }
  async history(userId: string) {
    try {
      const orders = await this.db.order.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, orderCode: true, status: true, total: true, redeemedPoints: true, loyaltyDiscountAmount: true, redemptionState: true, createdAt: true,
          loyaltyAward: { select: { points: true, reversedAt: true } } } });
      const codes = await customerOrderCodes(this.db, orders.map((order) => order.id));
      return { items: orders.map((order) => ({ id: order.id, orderCode: order.orderCode, customerOrderCode: codes.get(order.id) ?? order.orderCode, status: order.status,
        total: order.total.toFixed(0), redeemedPoints: order.redeemedPoints, loyaltyDiscountAmount: order.loyaltyDiscountAmount.toFixed(0), redemptionState: order.redemptionState, currency: 'VND', createdAt: order.createdAt.toISOString(), earnedPoints: earnedPoints(order) })) };
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException(); }
  }
  async cancel(userId: string, id: string, timeout = false) {
    try {
      return await this.transaction(async (tx) => {
        await lockUser(tx, userId);
        // Exclude another owner's row before PostgreSQL tries to lock it.
        // Its existence/lock state must not change the customer's404 contract.
        const owned = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id::text=${id} AND user_id::text=${userId} FOR UPDATE`;
        if (!owned.length) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
        const order = await tx.order.findFirst({ where: { id, userId }, include });
        if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
        const code = await customerOrderCode(tx, id, order.orderCode);
        if (order.status === 'CANCELLED') return detail(order, code);
        await tx.$executeRaw`SELECT set_config('brewlite.actor_id',${timeout ? '' : userId},true)`;
        if (!timeout && order.status === 'PAID') {
          assertPaidCancellation(order);
          await this.cancelPaid(tx, order, userId, 'Khách hủy trong thời hạn 120 giây');
          return detail(await tx.order.findUniqueOrThrow({ where: { id }, include }), code);
        }
        if (timeout && (!order.paymentExpiresAt || order.paymentExpiresAt > new Date() || !['PENDING', 'PAYMENT_FAILED'].includes(order.status))) return detail(order, code);
        if (!['PENDING', 'PAYMENT_FAILED'].includes(order.status)) throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Only unpaid orders can be cancelled' });
        await lockAttempts(tx, id);
        const blocks = await gatewayBlocks(tx, id);
        if (timeout) {
          const expiredAt = order.paymentExpiredAt ?? new Date();
          if (!order.paymentExpiredAt) await tx.order.update({ where: { id }, data: { paymentExpiredAt: expiredAt } });
          // Time proves URL expiry, never a financial failure. Preserve late IPN.
          if (blocks.pending || blocks.receipt || blocks.review) return detail({ ...order, paymentExpiredAt: expiredAt }, code);
        } else {
          const now = new Date();
          await tx.paymentVerification.updateMany({ where: { attempt: { orderId: id }, processedAt: null }, data: { processedAt: now } });
          await tx.paymentAttempt.updateMany({ where: { orderId: id, OR: [{ applicationState: { in: ['PENDING', 'REVIEW'] } }, { state: { in: ['AWAITING', 'UNKNOWN'] } }] }, data: { state: 'FAILED', applicationState: 'APPLIED', verifiedAt: now, appliedAt: now } });
        }
        const account = await reconcileAccount(tx, userId); const before = { ...account };
        const effects = order.status === 'PENDING' && order.redeemedPoints > 0 && order.redemptionState === 'RESERVED' ? [effect(account, 'RELEASE', order.redeemedPoints, { orderId: id, cycle: order.reservationCycle })] : [];
        assertTransition(order.status, 'CANCELLED');
        if (order.version >= 2147483647) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Order version bounds exceeded' });
        const changed = await tx.order.updateMany({ where: { id, userId, status: order.status, version: order.version },
          data: { status: 'CANCELLED', ...(timeout ? { cancellationReason: 'PAYMENT_TIMEOUT' } : {}), redemptionState: order.redeemedPoints > 0 ? 'RELEASED' : 'NONE', version: { increment: 1 }, updatedAt: new Date() } });
        if (changed.count !== 1) throw conflict();
        if (order.status === 'PENDING') await this.restoreStock(tx, order);
        if (effects.length) await persistEffects(tx, before, account, effects);
        return detail(await tx.order.findUniqueOrThrow({ where: { id }, include }), code);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isConcurrencyError(error)) throw conflict();
      throw new ServiceUnavailableException();
    }
  }
  async confirmNoCancel(userId: string, id: string) {
    try {
      return await this.transaction(async (tx) => {
        await lockUser(tx, userId);
        const owned = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE id::text=${id} AND user_id::text=${userId} FOR UPDATE`;
        if (!owned.length) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
        const order = await tx.order.findFirst({ where: { id, userId }, include });
        if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
        const code = await customerOrderCode(tx, id, order.orderCode);
        if (order.status === 'PAID' && order.noCancelConfirmedAt) return detail(order, code);
        if (order.status !== 'PAID' || !order.paidAt) {
          throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Chỉ có thể xác nhận không hủy khi đơn đang ở trạng thái đã thanh toán.' });
        }
        if (order.version >= 2147483647) throw workflowUnavailable();
        const now = new Date();
        const changed = await tx.order.updateMany({
          where: { id, userId, status: 'PAID', version: order.version },
          data: { noCancelConfirmedAt: now, version: { increment: 1 }, updatedAt: now },
        });
        if (changed.count !== 1) throw conflict();
        return detail(await tx.order.findUniqueOrThrow({ where: { id }, include }), code);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isConcurrencyError(error)) throw conflict();
      throw new ServiceUnavailableException();
    }
  }
  // Cross-owner reads are exposed only by the STAFF/ADMIN guarded controller.
  // Keep the customer-owned methods above and the B16 write path separate.
  async operatorHistory(role: UserRole, status?: OrderStatus) {
    try {
      const orders = await this.db.order.findMany({ where: operatorScope(role, status),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, orderCode: true, status: true, total: true, redeemedPoints: true, loyaltyDiscountAmount: true, redemptionState: true, createdAt: true, version: true, updatedAt: true,
          loyaltyAward: { select: { points: true, reversedAt: true } } } });
      const codes = await customerOrderCodes(this.db, orders.map((order) => order.id));
      return { items: orders.map((order) => ({ id: order.id, orderCode: order.orderCode, customerOrderCode: codes.get(order.id) ?? order.orderCode, status: order.status,
        total: order.total.toFixed(0), redeemedPoints: order.redeemedPoints, loyaltyDiscountAmount: order.loyaltyDiscountAmount.toFixed(0), redemptionState: order.redemptionState, currency: 'VND', createdAt: order.createdAt.toISOString(), earnedPoints: earnedPoints(order),
        estimatedEarnedPoints: order.total.dividedBy(10000).floor().toNumber(), version: order.version, updatedAt: order.updatedAt.toISOString() })) };
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException(); }
  }
  async operatorGet(role: UserRole, id: string) {
    try {
      operatorScope(role);
      const order = await this.db.order.findFirst({ where: { id, ...(role === 'STAFF' ? { OR: [{ status: { in: staffReadable } }, { status: 'CANCELLED' as const, paidAt: { not: null } }] } : {}) }, include });
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      return { ...detail(order, await customerOrderCode(this.db, order.id, order.orderCode)), version: order.version, updatedAt: order.updatedAt.toISOString() };
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException(); }
  }
  private async restoreStock(tx: Prisma.TransactionClient, order: OrderRow, actorId = order.userId) {
    const demand = new Map<string, number>();
    for (const item of order.items) if (!item.ingredientKeysSnapshot?.length) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.qty);
    await changeOrderIngredients(tx, order.id, 'RELEASE', actorId);
    for (const [productId, qty] of [...demand].sort(([a], [b]) => a.localeCompare(b))) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      if (product.stock > 2147483647 - qty || product.version >= 2147483647) throw workflowUnavailable();
      const restored = await tx.product.updateMany({ where: { id: productId, version: product.version },
        data: { stock: { increment: qty }, version: { increment: 1 }, updatedAt: new Date() } });
      if (restored.count !== 1) throw conflict();
    }
  }

  // A03 authorized controllers and trusted test harness share this single write path.
  async transitionOrder(id: string, expectedVersion: number, targetStatus: OrderStatus, actorId?: string) {
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || expectedVersion > 2147483647) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Expected version must be a nonnegative INTEGER' });
    }
    if (!['PREPARING', 'READY', 'COMPLETED', 'CANCELLED'].includes(targetStatus)) {
      throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Transition belongs to another workflow' });
    }
    try {
      return await this.transaction(async (tx) => {
        const owner = await tx.order.findUnique({ where: { id }, select: { userId: true } });
        if (!owner) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
        // Join Payment/Cart serialization; reread after acquiring the owner lock.
        await lockUser(tx, owner.userId);
        await lockOrder(tx, id);
        const order = await tx.order.findUniqueOrThrow({ where: { id }, include });
        if (targetStatus === 'CANCELLED' && order.status === 'CANCELLED') return detail(order, await customerOrderCode(tx, id, order.orderCode));
        // Unpaid cancellation retains its existing customer/ownership write path.
        if (targetStatus === 'CANCELLED' && order.status !== 'PAID') {
          throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Internal cancellation requires a paid order' });
        }
        assertTransition(order.status, targetStatus);
        if (order.version !== expectedVersion) throw conflict();
        if (order.version >= 2147483647) throw workflowUnavailable();
        await tx.$executeRaw`SELECT set_config('brewlite.actor_id',${actorId ?? order.userId},true)`;
        if (targetStatus === 'CANCELLED') {
          await this.cancelPaid(tx, order, actorId ?? order.userId, 'Admin hủy đơn trước pha chế', actorId);
          return detail(await tx.order.findUniqueOrThrow({ where: { id }, include }), await customerOrderCode(tx, id, order.orderCode));
        }
        const now = new Date();
        const changed = await tx.order.updateMany({ where: { id, userId: order.userId, status: order.status, version: expectedVersion },
          data: { status: targetStatus, version: { increment: 1 }, updatedAt: now } });
        if (changed.count !== 1) throw conflict();
        if (targetStatus === 'PREPARING') await changeOrderIngredients(tx, id, 'CONSUME', actorId ?? order.userId);
        return detail(await tx.order.findUniqueOrThrow({ where: { id }, include }), await customerOrderCode(tx, id, order.orderCode));
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isConcurrencyError(error)) throw conflict();
      throw workflowUnavailable();
    }
  }

  // O01: hủy, hoàn phần giữ/tồn, thu hồi điểm và tạo refund cùng transaction.
  // Khóa User/Order + version/CAS và unique refund ngăn hoàn hai lần. Đơn 0 VND
  // không tạo cash refund; Payment thu thành công vẫn giữ SUCCEEDED.
  // Tạo đơn/giá/VNPAY và customerOrderCode giữ contract của clone hiện tại.
  private async cancelPaid(tx: Prisma.TransactionClient, order: OrderRow, actorId: string, reason: string, approvedById?: string) {
    if (order.status !== 'PAID' || order.version >= 2147483647) throw workflowUnavailable();
    const account = await reconcileAccount(tx, order.userId), before = { ...account }, now = new Date();
    const changed = await tx.order.updateMany({ where: { id: order.id, status: 'PAID', version: order.version }, data: {
      status: 'CANCELLED', cancellationReason: 'PAID_CANCELLATION',
      ...(order.redeemedPoints > 0 ? { redemptionState: 'REFUNDED' } : {}), version: { increment: 1 }, updatedAt: now } });
    if (changed.count !== 1) throw conflict();
    await this.restoreStock(tx, order, actorId);
    const award = order.loyaltyAward;
    if (!award || award.userId !== order.userId || award.reversedAt !== null) throw workflowUnavailable();
    const reversed = await tx.loyaltyAward.updateMany({ where: { id: award.id, orderId: order.id, userId: order.userId, reversedAt: null }, data: { reversedAt: now } });
    if (reversed.count !== 1) throw workflowUnavailable();
    const effects = [];
    if (order.redeemedPoints > 0) effects.push(effect(account, 'REFUND', order.redeemedPoints, { orderId: order.id }));
    effects.push(effect(account, 'REVERSE', award.points, { orderId: order.id }));
    await persistEffects(tx, before, account, effects);
    await this.requestCashRefund(tx, order, actorId, reason, approvedById);
  }
  private async event(tx: Prisma.TransactionClient, orderId: string, actorId: string, kind: 'REFUND'|'SUPPORT', status: string, note: string) {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { role: true } });
    await tx.orderTrackingEvent.create({ data: { orderId, actorId, actorRole: actor.role, kind, status, note } });
  }
  private async requestCashRefund(tx: Prisma.TransactionClient, order: OrderRow, actorId: string, reason: string, approvedById?: string) {
    if (order.total.isZero()) return null;
    const existing = await tx.orderRefund.findUnique({ where: { orderId: order.id } });
    if (existing) {
      if (approvedById && !existing.approvedAt && existing.status === 'PENDING') {
        await this.event(tx, order.id, actorId, 'REFUND', 'APPROVED', 'Admin phê duyệt yêu cầu hoàn tiền');
        return tx.orderRefund.update({ where: { id: existing.id }, data: { approvedById, approvedAt: new Date(), version: { increment: 1 }, updatedAt: new Date() } });
      }
      return existing;
    }
    const payment = await tx.payment.findFirst({ where: { orderId: order.id, userId: order.userId, status: 'SUCCEEDED' } });
    if (!payment || !payment.amount.equals(order.total) || !order.paidAt) throw new UnprocessableEntityException({ code: 'REFUND_NOT_AVAILABLE', message: 'Chưa có giao dịch thu tiền hợp lệ để hoàn.' });
    const refund = await tx.orderRefund.create({ data: { orderId: order.id, paymentId: payment.id, amount: payment.amount, reason, requestedById: actorId,
      ...(approvedById ? { approvedById, approvedAt: new Date() } : {}) } });
    await this.event(tx, order.id, actorId, 'REFUND', 'PENDING', 'Đã tạo yêu cầu hoàn tiền');
    return refund;
  }
  private async aftercare<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    try { return await this.transaction(work); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      if (isConcurrencyError(error) || error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict();
      throw workflowUnavailable();
    }
  }
  private async aftercareOrder(tx: Prisma.TransactionClient, actorId: string, role: UserRole, id: string, lock = false) {
    const order = await tx.order.findFirst({ where: { id, ...(role === 'CUSTOMER' ? { userId: actorId } : role === 'STAFF' ? { paidAt: { not: null } } : {}) }, include });
    if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng' });
    if (!lock) return order;
    await lockUser(tx, order.userId); await lockOrder(tx, id);
    await tx.$executeRaw`SELECT set_config('brewlite.actor_id',${actorId},true)`;
    return tx.order.findUniqueOrThrow({ where: { id }, include });
  }
  // Owner-only cho Customer; Staff chỉ đơn đã trả tiền, gồm CANCELLED đã trả.
  // Không tạo lịch sử ngược: STATUS do trigger ghi, SUPPORT/REFUND append-only.
  // Customer không nhận actorId; chỉ Admin nhận mã giao dịch/bằng chứng hoàn tiền.
  async tracking(actorId: string, role: UserRole, id: string) {
    return this.aftercare(async tx => {
      const order = await this.aftercareOrder(tx, actorId, role, id);
      const refund = await tx.orderRefund.findUnique({ where: { orderId: id } });
      const supports = await tx.orderSupportRequest.findMany({ where: { orderId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const events = await tx.orderTrackingEvent.findMany({ where: { orderId: id }, orderBy: { sequence: 'asc' } });
      return { orderId: id, status: order.status, serverNow: new Date().toISOString(), ...cancellationWindow(order),
        refund: refund ? { id: refund.id, status: refund.status, amount: refund.amount.toFixed(0), approved: !!refund.approvedAt, version: refund.version,
          createdAt: refund.createdAt.toISOString(), processedAt: refund.processedAt?.toISOString() ?? null, failureReason: refund.failureReason,
          ...(role === 'ADMIN' ? { transactionReference: refund.transactionReference, evidenceReference: refund.evidenceReference } : {}) } : null,
        supportRequests: supports.map(s => ({ id: s.id, reason: s.reason, status: s.status, version: s.version, reviewNote: s.reviewNote, createdAt: s.createdAt.toISOString() })),
        events: events.map(e => ({ id: e.id, kind: e.kind, fromStatus: e.fromStatus, status: e.status, actorRole: e.actorRole,
          ...(role !== 'CUSTOMER' ? { actorId: e.actorId } : {}), note: e.note, at: e.occurredAt.toISOString() })) };
    });
  }
  async supportRequest(actorId: string, role: UserRole, id: string, key: string | undefined, reason: string) {
    requireIdempotencyKey(key);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Mã yêu cầu hỗ trợ phải là UUID.' });
    }
    return this.aftercare(async tx => {
      const order = await this.aftercareOrder(tx, actorId, role, id, true);
      const where = { orderId_requestedById_requestKey: { orderId: id, requestedById: actorId, requestKey: key } };
      const existing = await tx.orderSupportRequest.findUnique({ where });
      if (existing) {
        if (existing.reason !== reason) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Yêu cầu cũ có nội dung khác' });
        return { id: existing.id, status: existing.status, version: existing.version };
      }
      if (!order.paidAt) throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Hỗ trợ ngoại lệ dành cho đơn đã thanh toán' });
      const support = await tx.orderSupportRequest.create({ data: { orderId: id, requestedById: actorId, requestKey: key, reason } });
      await this.event(tx, id, actorId, 'SUPPORT', 'OPEN', reason);
      return { id: support.id, status: support.status, version: support.version };
    });
  }
  async reviewSupport(actorId: string, id: string, requestId: string, input: SupportReviewDto) {
    return this.aftercare(async tx => {
      const order = await this.aftercareOrder(tx, actorId, 'ADMIN', id, true);
      const request = await tx.orderSupportRequest.findFirst({ where: { id: requestId, orderId: id } });
      if (!request) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Không tìm thấy yêu cầu' });
      const status = input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (request.status === status && request.reviewNote === input.note) return { id: request.id, status, version: request.version };
      if (request.status !== 'OPEN' || request.version !== input.expectedVersion) throw conflict();
      if (input.action === 'APPROVE') {
        if (!order.paidAt) throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Đơn chưa thanh toán' });
        if (order.status === 'PAID') await this.cancelPaid(tx, order, actorId, input.note, actorId);
        else await this.requestCashRefund(tx, order, actorId, input.note, actorId);
      }
      const result = await tx.orderSupportRequest.update({ where: { id: requestId }, data: { status, version: { increment: 1 }, reviewedById: actorId, reviewedAt: new Date(), reviewNote: input.note } });
      await this.event(tx, id, actorId, 'SUPPORT', status, input.note);
      return { id: result.id, status: result.status, version: result.version };
    });
  }
  // Ghi nhận hoàn tiền thủ công, không gọi API chuyển tiền. SUCCEEDED cần đã
  // duyệt + transactionReference + evidenceReference; FAILED cần lý do.
  // RETRY chỉ mở lại FAILED; bản SUCCEEDED được trigger bảo vệ khỏi sửa/xóa.
  async updateRefund(actorId: string, id: string, input: RefundUpdateDto) {
    return this.aftercare(async tx => {
      await this.aftercareOrder(tx, actorId, 'ADMIN', id, true);
      const refund = await tx.orderRefund.findUnique({ where: { orderId: id } });
      if (!refund) throw new UnprocessableEntityException({ code: 'REFUND_NOT_AVAILABLE', message: 'Chưa có yêu cầu hoàn tiền' });
      if (input.action === 'SUCCEEDED' && refund.status === 'SUCCEEDED' && refund.transactionReference === input.transactionReference && refund.evidenceReference === input.evidenceReference
        || input.action === 'APPROVE' && !!refund.approvedAt
        || input.action === 'FAILED' && refund.status === 'FAILED' && refund.failureReason === input.note) return { id: refund.id, status: refund.status, version: refund.version };
      if (refund.version !== input.expectedVersion || refund.status === 'SUCCEEDED') throw conflict();
      const now = new Date(); let data: Prisma.OrderRefundUncheckedUpdateInput;
      if (input.action === 'APPROVE' && refund.status === 'PENDING') data = { approvedById: actorId, approvedAt: now };
      else if (input.action === 'RETRY' && refund.status === 'FAILED') data = { status: 'PENDING', failureReason: null, processedById: null, processedAt: null };
      else if (input.action === 'SUCCEEDED' && refund.status === 'PENDING' && refund.approvedAt && input.transactionReference && input.evidenceReference)
        data = { status: 'SUCCEEDED', processedById: actorId, processedAt: now, transactionReference: input.transactionReference, evidenceReference: input.evidenceReference };
      else if (input.action === 'FAILED' && refund.status === 'PENDING' && refund.approvedAt && input.note)
        data = { status: 'FAILED', processedById: actorId, processedAt: now, failureReason: input.note };
      else throw new UnprocessableEntityException({ code: 'REFUND_EVIDENCE_REQUIRED', message: 'Cần phê duyệt và thông tin xác nhận hợp lệ trước khi cập nhật hoàn tiền.' });
      const result = await tx.orderRefund.update({ where: { id: refund.id }, data: { ...data, version: { increment: 1 }, updatedAt: now } });
      await this.event(tx, id, actorId, 'REFUND', input.action === 'APPROVE' ? 'APPROVED' : result.status, input.action === 'FAILED' ? input.note! : 'Cập nhật xử lý yêu cầu hoàn tiền');
      return { id: result.id, status: result.status, version: result.version };
    });
  }
}

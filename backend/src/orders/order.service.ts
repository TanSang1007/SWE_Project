import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma, type OrderStatus, type UserRole } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import type { CreateOrderDto, OrderItemDto } from './order.dto';
import { assertNoActiveOrder, lockUser } from './order-policy';
import { requireIdempotencyKey, replayResult } from '../common/idempotency';
import { assertTransition } from './order-state';
import { effect, lockOrder, persistEffects, reconcileAccount, validateRedemption } from '../loyalty/loyalty-accounting';
import { assertGatewayClear, gatewayBlocks, lockAttempts } from '../payments/gateway-policy';
import { assertVnpayMinimum, effectivePaymentProvider } from '../payments/minimum-payment-policy';
import { assertPaymentAdmission } from '../payments/payment-admission';

export function normalizeItems(items: OrderItemDto[]) {
  const map = new Map<string, OrderItemDto>();
  for (const item of items) {
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
function response(order: OrderRow) {
  return { id: order.id, orderCode: order.orderCode, status: order.status, currency: 'VND',
    items: order.items.map((item) => ({ productId: item.productId, productName: item.productNameSnapshot, size: item.size, qty: item.qty,
      unitPrice: item.unitPrice.toFixed(0), lineTotal: item.lineTotal.toFixed(0),
      toppings: item.toppings.map((t) => ({ name: t.toppingNameSnapshot, price: t.priceSnapshot.toFixed(0) })) })),
    subtotal: order.subtotal.toFixed(0), discountAmount: order.discountAmount.toFixed(0), total: order.total.toFixed(0),
    promotionCode: order.promotionCodeSnapshot, createdAt: order.createdAt.toISOString(),
    redeemedPoints: order.redeemedPoints, loyaltyDiscountAmount: order.loyaltyDiscountAmount.toFixed(0),
    redemptionState: order.redemptionState, estimatedEarnedPoints: order.total.dividedBy(10000).floor().toNumber() };
}
function detail(order: OrderRow) {
  return { ...response(order), paidAt: order.paidAt?.toISOString() ?? null,
    earnedPoints: earnedPoints(order),
    paymentStatus: order.payments[0]?.status ?? null };
}

@Injectable()
export class OrderService {
  constructor(private readonly db: PrismaService, private readonly pricing: PricingService, private readonly config: ConfigService) {}
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', '200ms', true), set_config('statement_timeout', '300ms', true), set_config('TimeZone', 'UTC', true)`;
      return work(tx);
    }, { maxWait: 50, timeout: 400 });
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
        if (effectivePaymentProvider(this.config) === 'VNPAY_SANDBOX') {
          assertVnpayMinimum(loyalty.total);
          if (loyalty.total.gt(0)) assertPaymentAdmission(this.config);
        }
        const id = randomUUID();
        const effects = r > 0 ? [effect(account, 'RESERVE', r, { orderId: id, cycle: 1 })] : [];
        for (const demand of priced.stockRequirements) {
          if (demand.version >= 2147483647) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Stock version bounds exceeded' });
          const updated = await tx.product.updateMany({ where: { id: demand.productId, version: demand.version, stock: { gte: demand.qty } },
            data: { stock: { decrement: demand.qty }, version: { increment: 1 }, updatedAt: new Date() } });
          if (updated.count !== 1) throw conflict();
        }
        const order = await tx.order.create({ data: { id, orderCode: `BL-${id.toUpperCase()}`, userId, status: 'PENDING',
          subtotal: priced.subtotal, discountAmount: priced.discountAmount, total: loyalty.total, redeemedPoints: r, loyaltyDiscountAmount: loyalty.discount,
          redemptionState: r > 0 ? 'RESERVED' : 'NONE', reservationCycle: r > 0 ? 1 : 0,
          promotionId: promotion?.id ?? null, promotionCodeSnapshot: promotion?.code ?? null,
          items: { create: priced.items.map((item) => ({ productId: item.productId, productNameSnapshot: item.productName, size: item.size,
            basePrice: item.basePrice, sizeExtraPrice: item.sizeExtraPrice, unitPrice: item.unitPrice, qty: item.qty, lineTotal: item.lineTotal,
            toppings: { create: item.toppings.map((t) => ({ toppingId: t.id, toppingNameSnapshot: t.name, priceSnapshot: t.price })) } })) } }, include });
        if (effects.length) await persistEffects(tx, before, account, effects);
        const body = response(order);
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2028', 'P2034', 'P2010'].includes(error.code)) {
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
      }, { isolationLevel: 'RepeatableRead', maxWait: 50, timeout: 400 });
    } catch (error) { if (error instanceof HttpException) throw error; throw workflowUnavailable(); }
  }
  async get(userId: string, id: string) {
    try {
      const order = await this.db.order.findFirst({ where: { id, userId }, include });
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      return detail(order);
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException(); }
  }
  async history(userId: string) {
    try {
      const orders = await this.db.order.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, orderCode: true, status: true, total: true, redeemedPoints: true, loyaltyDiscountAmount: true, redemptionState: true, createdAt: true,
          loyaltyAward: { select: { points: true, reversedAt: true } } } });
      return { items: orders.map((order) => ({ id: order.id, orderCode: order.orderCode, status: order.status,
        total: order.total.toFixed(0), redeemedPoints: order.redeemedPoints, loyaltyDiscountAmount: order.loyaltyDiscountAmount.toFixed(0), redemptionState: order.redemptionState, currency: 'VND', createdAt: order.createdAt.toISOString(), earnedPoints: earnedPoints(order) })) };
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException(); }
  }
  async cancel(userId: string, id: string) {
    try {
      return await this.transaction(async (tx) => {
        await lockUser(tx, userId);
        await lockOrder(tx, id);
        const order = await tx.order.findFirst({ where: { id, userId }, include });
        if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
        if (order.status === 'CANCELLED') return detail(order);
        if (!['PENDING', 'PAYMENT_FAILED'].includes(order.status)) throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Only unpaid orders can be cancelled' });
        await lockAttempts(tx, id); assertGatewayClear(await gatewayBlocks(tx, id));
        const account = await reconcileAccount(tx, userId); const before = { ...account };
        const effects = order.status === 'PENDING' && order.redeemedPoints > 0 ? [effect(account, 'RELEASE', order.redeemedPoints, { orderId: id, cycle: order.reservationCycle })] : [];
        assertTransition(order.status, 'CANCELLED');
        if (order.version >= 2147483647) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Order version bounds exceeded' });
        const changed = await tx.order.updateMany({ where: { id, userId, status: order.status, version: order.version },
          data: { status: 'CANCELLED', redemptionState: order.redeemedPoints > 0 ? 'RELEASED' : 'NONE', version: { increment: 1 }, updatedAt: new Date() } });
        if (changed.count !== 1) throw conflict();
        if (order.status === 'PENDING') await this.restoreStock(tx, order);
        if (effects.length) await persistEffects(tx, before, account, effects);
        return detail(await tx.order.findUniqueOrThrow({ where: { id }, include }));
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2028', 'P2034', 'P2010'].includes(error.code)) throw conflict();
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
      return { items: orders.map((order) => ({ id: order.id, orderCode: order.orderCode, status: order.status,
        total: order.total.toFixed(0), redeemedPoints: order.redeemedPoints, loyaltyDiscountAmount: order.loyaltyDiscountAmount.toFixed(0), redemptionState: order.redemptionState, currency: 'VND', createdAt: order.createdAt.toISOString(), earnedPoints: earnedPoints(order),
        estimatedEarnedPoints: order.total.dividedBy(10000).floor().toNumber(), version: order.version, updatedAt: order.updatedAt.toISOString() })) };
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException(); }
  }
  async operatorGet(role: UserRole, id: string) {
    try {
      operatorScope(role);
      const order = await this.db.order.findFirst({ where: { id, ...(role === 'STAFF' ? { status: { in: staffReadable } } : {}) }, include });
      if (!order) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
      return { ...detail(order), version: order.version, updatedAt: order.updatedAt.toISOString() };
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException(); }
  }
  private async restoreStock(tx: Prisma.TransactionClient, order: OrderRow) {
    const demand = new Map<string, number>();
    for (const item of order.items) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.qty);
    for (const [productId, qty] of [...demand].sort(([a], [b]) => a.localeCompare(b))) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      if (product.stock > 2147483647 - qty || product.version >= 2147483647) throw workflowUnavailable();
      const restored = await tx.product.updateMany({ where: { id: productId, version: product.version },
        data: { stock: { increment: qty }, version: { increment: 1 }, updatedAt: new Date() } });
      if (restored.count !== 1) throw conflict();
    }
  }

  // A03 authorized controllers and trusted test harness share this single write path.
  async transitionOrder(id: string, expectedVersion: number, targetStatus: OrderStatus) {
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
        if (targetStatus === 'CANCELLED' && order.status === 'CANCELLED') return detail(order);
        // Unpaid cancellation retains its existing customer/ownership write path.
        if (targetStatus === 'CANCELLED' && order.status !== 'PAID') {
          throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Internal cancellation requires a paid order' });
        }
        assertTransition(order.status, targetStatus);
        if (order.version !== expectedVersion) throw conflict();
        if (order.version >= 2147483647) throw workflowUnavailable();
        const account = targetStatus === 'CANCELLED' ? await reconcileAccount(tx, order.userId) : null;
        const before = account ? { ...account } : null;
        const now = new Date();
        const changed = await tx.order.updateMany({ where: { id, userId: order.userId, status: order.status, version: expectedVersion },
          data: { status: targetStatus, ...(targetStatus === 'CANCELLED' && order.redeemedPoints > 0 ? { redemptionState: 'REFUNDED' } : {}), version: { increment: 1 }, updatedAt: now } });
        if (changed.count !== 1) throw conflict();
        if (targetStatus === 'CANCELLED') {
          await this.restoreStock(tx, order);
          const award = order.loyaltyAward;
          if (!award || award.userId !== order.userId || award.reversedAt !== null) throw workflowUnavailable();
          const reversed = await tx.loyaltyAward.updateMany({ where: { id: award.id, orderId: id, userId: order.userId, reversedAt: null },
            data: { reversedAt: now } });
          if (reversed.count !== 1) throw workflowUnavailable();
          if (!account || !before) throw workflowUnavailable();
          const effects = [];
          if (order.redeemedPoints > 0) effects.push(effect(account, 'REFUND', order.redeemedPoints, { orderId: id }));
          effects.push(effect(account, 'REVERSE', award.points, { orderId: id }));
          await persistEffects(tx, before, account, effects);
        }
        return detail(await tx.order.findUniqueOrThrow({ where: { id }, include }));
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Prisma 7 adapter-pg carries SQLSTATE under driverAdapterError.cause;
        // other engines expose meta.code. Only recognized concurrency faults map409.
        const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
        const sqlState = typeof error.meta?.code === 'string' ? error.meta.code : adapter?.cause?.originalCode ?? '';
        if (['P2028', 'P2034'].includes(error.code) || ['55P03', '57014', '40P01', '40001'].includes(sqlState)) throw conflict();
      }
      throw workflowUnavailable();
    }
  }
}

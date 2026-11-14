import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpException,
  Injectable,
  NotFoundException,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { requireIdempotencyKey, replayResult } from '../common/idempotency';
import { lockUser } from '../orders/order-policy';
import { effect, lockOrder, persistEffects, reconcileAccount, reservationGate, type Effect } from '../loyalty/loyalty-accounting';
import { assertGatewayClear, gatewayBlocks, lockAttempts } from './gateway-policy';
import { assertPaymentWindow } from './payment-deadline';
import { clearPurchasedCart } from './cart-cleanup';

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trimUpper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class CreatePaymentDto {
  @Transform(trimLower)
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  orderId!: string;

  @IsOptional()
  @Transform(trimUpper)
  @IsIn(['WALLET', 'CARD'])
  method?: 'WALLET' | 'CARD';

  @IsOptional()
  @Transform(trimUpper)
  @IsIn(['SUCCESS', 'SUCCEEDED', 'FAILED'])
  outcome?: 'SUCCESS' | 'SUCCEEDED' | 'FAILED';
}

const include = { items: { include: { toppings: true } }, payments: true, loyaltyAward: true };

@Injectable()
export class MockPaymentService {
  constructor(private readonly db: PrismaService) {}

  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async (tx) => {
      await (this.db.transactionOptions?.timeout === 5000
        ? tx.$executeRaw`SELECT set_config('lock_timeout','2000ms',true),set_config('statement_timeout','4000ms',true),set_config('TimeZone','UTC',true)`
        : tx.$executeRaw`SELECT set_config('lock_timeout','200ms',true),set_config('statement_timeout','300ms',true),set_config('TimeZone','UTC',true)`);
      return work(tx);
    }, this.db.transactionOptions ?? { maxWait: 50, timeout: 400 });
  }

  async pay(userId: string, key: string | undefined, input: CreatePaymentDto) {
    requireIdempotencyKey(key);
    const orderId = input.orderId;
    const method = input.method ?? 'WALLET';
    const success = input.outcome !== 'FAILED';
    const hash = createHash('sha256')
      .update(JSON.stringify({ action: 'MOCK_PAY_V1', orderId, method, success }))
      .digest('hex');
    const where = { userId_operation_idempotencyKey: { userId, operation: 'PAY_ORDER' as const, idempotencyKey: key } };

    try {
      return await this.transaction(async (tx) => {
        if (!(await tx.order.findFirst({ where: { id: orderId, userId }, select: { id: true } }))) {
          throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
        }
        await lockUser(tx, userId);
        await lockOrder(tx, orderId);
        const o = await tx.order.findFirstOrThrow({ where: { id: orderId, userId }, include });
        const previous = await tx.idempotencyRequest.findUnique({ where });
        if (previous) return replayResult(previous, hash);

        await lockAttempts(tx, orderId);
        assertGatewayClear(await gatewayBlocks(tx, orderId));
        if (['PAID', 'PREPARING', 'READY', 'COMPLETED'].includes(o.status) || o.payments.some((p) => p.status === 'SUCCEEDED')) {
          throw new ConflictException({ code: 'ORDER_ALREADY_PAID', message: 'Order already paid' });
        }
        if (!['PENDING', 'PAYMENT_FAILED'].includes(o.status)) {
          throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Order does not permit payment' });
        }
        assertPaymentWindow(o);
        if (o.version >= 2147483647) {
          throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Order version bounds exceeded' });
        }

        const before = await reconcileAccount(tx, userId);
        const account = { ...before };
        reservationGate(account, o.redeemedPoints);
        const now = new Date();
        const claim = await tx.idempotencyRequest.create({
          data: { userId, operation: 'PAY_ORDER', idempotencyKey: key, requestHash: hash, state: 'PROCESSING' },
        });

        let cycle = o.reservationCycle;
        const effects: Effect[] = [];

        if (o.status === 'PAYMENT_FAILED') {
          if (o.redeemedPoints > 0 && account.available < BigInt(o.redeemedPoints)) {
            throw new ConflictException({ code: 'LOYALTY_INSUFFICIENT_POINTS', message: 'Insufficient points for reservation' });
          }
          const demand = new Map<string, number>();
          for (const item of o.items) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.qty);
          for (const [productId, qty] of [...demand].sort(([a], [b]) => a.localeCompare(b))) {
            const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
            if (p.stock < qty) throw new ConflictException({ code: 'OUT_OF_STOCK', message: 'Insufficient stock for payment retry' });
            const updated = await tx.product.updateMany({
              where: { id: productId, version: p.version, stock: { gte: qty } },
              data: { stock: { decrement: qty }, version: { increment: 1 }, updatedAt: now },
            });
            if (updated.count !== 1) throw new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Concurrent stock update' });
          }
          if (o.redeemedPoints > 0) cycle = o.reservationCycle + 1;
        }

        if (!success && o.status === 'PENDING') {
          const demand = new Map<string, number>();
          for (const item of o.items) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.qty);
          for (const [productId, qty] of [...demand].sort(([a], [b]) => a.localeCompare(b))) {
            const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
            const updated = await tx.product.updateMany({
              where: { id: productId, version: p.version },
              data: { stock: { increment: qty }, version: { increment: 1 }, updatedAt: now },
            });
            if (updated.count !== 1) throw new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Concurrent stock update' });
          }
        }

        const nextStatus = success ? 'PAID' : 'PAYMENT_FAILED';
        const nextRedemptionState = o.redeemedPoints > 0 ? (success ? 'SETTLED' : 'RELEASED') : 'NONE';
        const changed = await tx.order.updateMany({
          where: { id: orderId, userId, status: o.status, version: o.version },
          data: {
            status: nextStatus,
            redemptionState: nextRedemptionState,
            reservationCycle: cycle,
            ...(success ? { paidAt: now } : {}),
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Concurrent order update' });
        }

        const payment = await tx.payment.create({
          data: {
            orderId,
            userId,
            idempotencyRequestId: claim.id,
            idempotencyKey: key,
            amount: o.total,
            provider: 'MOCK',
            method,
            status: success ? 'SUCCEEDED' : 'FAILED',
            failureCode: success ? null : 'PAYMENT_DECLINED',
            confirmedAt: now,
          },
        });

        if (o.status === 'PAYMENT_FAILED' && o.redeemedPoints > 0) {
          effects.push(effect(account, 'RESERVE', o.redeemedPoints, { orderId, paymentId: payment.id, cycle }));
        }
        if (o.redeemedPoints > 0) {
          effects.push(effect(account, success ? 'SETTLE' : 'RELEASE', o.redeemedPoints, { orderId, paymentId: payment.id, cycle }));
        }

        let awardedPoints = 0;
        if (success) {
          await clearPurchasedCart(tx, userId);
          awardedPoints = o.total.dividedBy(10000).floor().toNumber();
          await tx.loyaltyAward.create({ data: { orderId, userId, points: awardedPoints } });
          effects.push(effect(account, 'EARN', awardedPoints, { orderId, paymentId: payment.id }));
        }
        if (effects.length) {
          await persistEffects(tx, before, account, effects);
        }

        const body = {
          payment: {
            id: payment.id,
            orderId,
            provider: payment.provider,
            status: payment.status,
            amount: o.total.toFixed(0),
            method: payment.method,
            failureCode: payment.failureCode,
          },
          order: { id: orderId, orderCode: o.orderCode, status: nextStatus },
          earnedPoints: awardedPoints,
        };
        await tx.idempotencyRequest.update({
          where: { id: claim.id },
          data: { state: 'COMPLETED', orderId, responseStatus: 200, responseBody: body, completedAt: now },
        });
        return { body, replayed: false };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      try {
        const previous = await this.transaction(async (tx) => {
          if (!(await tx.order.findFirst({ where: { id: orderId, userId }, select: { id: true } }))) {
            throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
          }
          return tx.idempotencyRequest.findUnique({ where });
        });
        if (previous) return replayResult(previous, hash);
      } catch (recovery) {
        if (recovery instanceof HttpException) throw recovery;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2028', 'P2034'].includes(error.code)) {
        throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Retry the same key later' });
      }
      throw new ServiceUnavailableException({ code: 'PAYMENT_UNAVAILABLE', message: 'Payment was not committed; retry the same request' });
    }
  }
}

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class MockPaymentController {
  constructor(private readonly payments: MockPaymentService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async create(
    @Req() req: Request & { user: { id: string } },
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: CreatePaymentDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.vary('Authorization');
    const result = await this.payments.pay(req.user.id, key, body);
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }
}

import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { lockUser } from '../orders/order-policy';
import { effect, lockOrder, persistEffects, reconcileAccount, reservationGate } from '../loyalty/loyalty-accounting';
import { requireIdempotencyKey, replayResult } from '../common/idempotency';
import { assertGatewayClear, gatewayBlocks, lockAttempts } from './gateway-policy';
import { buildPaymentUrl, toVnpayAmount } from './vnpay/vnpay-pay';
import type { VnpayConfig } from './vnpay/vnpay-config';
import type { AttemptListDto } from './attempt.dto';
import { decodeAttemptCursor, encodeAttemptCursor } from './attempt-cursor';
import { assertVnpayMinimum, belowVnpayMinimum } from './minimum-payment-policy';
import { acceptsNewPayments, assertPaymentAdmission } from './payment-admission';
import { assertPaymentWindow, PAYMENT_WINDOW_MS } from './payment-deadline';
const unavailable = () => new ServiceUnavailableException({ code: 'PAYMENT_UNAVAILABLE', message: 'Payment initiation unavailable' });
const stateError = () => new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Order does not permit this payment action' });
const conflict = () => new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Data changed; read the current order and try again' });
const maxInt = 2147483647;
const orderInclude = { items: true, payments: { orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }], take: 1 } };
type Order = Prisma.OrderGetPayload<{
    include: typeof orderInclude;
}>;
const attemptSelect = { id: true, orderId: true, idempotencyRequestId: true, provider: true, amount: true, currency: true, state: true, responseCode: true, transactionStatus: true,
    applicationState: true, createdAt: true, expiresAt: true, verifiedAt: true, appliedAt: true,
    payment: { select: { id: true, userId: true, orderId: true, provider: true, amount: true, status: true, gatewayAttemptId: true, idempotencyRequestId: true, confirmedAt: true } },
    verifications: { select: { state: true, processedAt: true, payload: true } } };
type Attempt = Prisma.PaymentAttemptGetPayload<{
    select: typeof attemptSelect;
}>;
type Blocks = Awaited<ReturnType<typeof gatewayBlocks>>;
function terminalBound(a: Attempt, o: Order, success: boolean) {
    const p = a.payment;
    return a.applicationState === 'APPLIED' && a.state === (success ? 'SUCCEEDED' : 'FAILED') && !!a.verifiedAt && !!a.appliedAt
        && !!p && p.status === (success ? 'SUCCEEDED' : 'FAILED') && p.provider === 'VNPAY_SANDBOX' && p.gatewayAttemptId === a.id
        && p.userId === o.userId && p.orderId === o.id && p.amount.equals(o.total) && a.amount.equals(o.total)
        && p.idempotencyRequestId === a.idempotencyRequestId && !!p.confirmedAt
        && a.verifications.some(v => v.state === 'VERIFIED' && v.processedAt !== null);
}
function providerDate(date: Date) { return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 19).replace(/[-:T]/g, ''); }
@Injectable()
export class AttemptService {
    constructor(private readonly db: PrismaService, private readonly config: ConfigService) { }
    private enabled() { return this.config.get<string>('PAYMENT_PROVIDER_MODE') === 'VNPAY_SANDBOX' && !!this.config.get<VnpayConfig>('VNPAY_INITIATION_CONFIG'); }
    private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
        return this.db.$transaction(async (tx) => {
            await tx.$executeRaw `SELECT set_config('lock_timeout','200ms',true),set_config('statement_timeout','300ms',true),set_config('TimeZone','UTC',true)`;
            return work(tx);
        }, this.db.transactionOptions ?? { maxWait: 50, timeout: 400 });
    }
    private async owned(tx: Prisma.TransactionClient, userId: string, id: string) {
        const o = await tx.order.findFirst({ where: { id, userId }, include: orderInclude });
        if (!o)
            throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
        return o;
    }
    private latest(tx: Prisma.TransactionClient, orderId: string) {
        return tx.paymentAttempt.findFirst({ where: { orderId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: attemptSelect });
    }
    private retryEligible(o: Order, a: Attempt | null) {
        return !!a && o.status === 'PAYMENT_FAILED' && terminalBound(a, o, false) && o.payments[0]?.id === a.payment?.id
            && o.version < maxInt && (o.redeemedPoints === 0 || (o.redemptionState === 'RELEASED' && o.reservationCycle < maxInt));
    }
    private async reserveStock(tx: Prisma.TransactionClient, o: Order) {
        const demand = new Map<string, number>();
        for (const item of o.items)
            demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.qty);
        for (const [id, qty] of [...demand].sort(([a], [b]) => a.localeCompare(b))) {
            const p = await tx.product.findUniqueOrThrow({ where: { id } });
            if (p.stock < qty)
                throw new ConflictException({ code: 'OUT_OF_STOCK', message: 'Insufficient stock for payment retry' });
            if (p.version >= maxInt)
                throw unavailable();
            const changed = await tx.product.updateMany({ where: { id, version: p.version, stock: { gte: qty } }, data: { stock: { decrement: qty }, version: { increment: 1 }, updatedAt: new Date() } });
            if (changed.count !== 1)
                throw conflict();
        }
    }
    async initiate(userId: string, key: string | undefined, orderId: string, customerIp: string) {
        requireIdempotencyKey(key);
        if (!this.enabled())
            throw unavailable();
        const settings = this.config.getOrThrow<VnpayConfig>('VNPAY_INITIATION_CONFIG');
        const hash = createHash('sha256').update(JSON.stringify({ action: 'VNPAY_INITIATE_V1', orderId })).digest('hex');
        const where = { userId_operation_idempotencyKey: { userId, operation: 'PAY_ORDER' as const, idempotencyKey: key } };
        try {
            return await this.transaction(async (tx) => {
                await this.owned(tx, userId, orderId);
                await lockUser(tx, userId);
                await lockOrder(tx, orderId);
                await lockAttempts(tx, orderId);
                const o = await this.owned(tx, userId, orderId);
                const previous = await tx.idempotencyRequest.findUnique({ where });
                if (previous) {
                    const body = previous.responseBody as { expiresAt?: string } | null;
                    if (body?.expiresAt && new Date(body.expiresAt) <= new Date()) throw new ConflictException({ code: 'PAYMENT_TIMEOUT', message: 'Payment link expired' });
                    return replayResult(previous, hash);
                }
                assertPaymentWindow(o);
                const blocks = await gatewayBlocks(tx, orderId);
                assertGatewayClear(blocks);
                if (['PAID', 'PREPARING', 'READY', 'COMPLETED'].includes(o.status))
                    throw new ConflictException({ code: 'ORDER_ALREADY_PAID', message: 'Order already paid' });
                if (!['PENDING', 'PAYMENT_FAILED'].includes(o.status))
                    throw stateError();
                const latest = await this.latest(tx, orderId);
                if (o.status === 'PAYMENT_FAILED' && !this.retryEligible(o, latest))
                    throw stateError();
                if (o.status === 'PENDING' && latest)
                    throw stateError(); // Never reissue a URL for an unexplained prior attempt.
                assertVnpayMinimum(o.total);
                try {
                    toVnpayAmount(o.total.toFixed(0));
                }
                catch {
                    throw new UnprocessableEntityException({ code: 'PAYMENT_AMOUNT_UNSUPPORTED', message: 'Order amount is unsupported by the gateway' });
                }
                assertPaymentAdmission(this.config);
                const before = await reconcileAccount(tx, userId), account = { ...before };
                reservationGate(account, o.redeemedPoints);
                if (o.status === 'PAYMENT_FAILED' && account.available < BigInt(o.redeemedPoints))
                    throw new ConflictException({ code: 'LOYALTY_INSUFFICIENT_POINTS', message: 'Insufficient points for the original reservation' });
                const now = new Date(), expiresAt = o.paymentExpiresAt ?? new Date(now.getTime() + PAYMENT_WINDOW_MS), ref = randomUUID().replaceAll('-', '');
                const paymentUrl = buildPaymentUrl(settings, { orderTotalVnd: o.total.toFixed(0), txnRef: ref, createDate: providerDate(now), expireDate: providerDate(expiresAt), customerIp });
                const parameters = Object.fromEntries(new URL(paymentUrl).searchParams);
                delete parameters.vnp_SecureHash;
                const claim = await tx.idempotencyRequest.create({ data: { userId, operation: 'PAY_ORDER', idempotencyKey: key, requestHash: hash, state: 'PROCESSING' } });
                const a = await tx.paymentAttempt.create({ data: { orderId, idempotencyRequestId: claim.id, merchantCode: settings.merchantCode, txnRef: ref, amount: o.total,
                        createDate: parameters.vnp_CreateDate, expiresAt, createdAt: now, requestParameters: parameters } });
                const body = { attemptId: a.id, orderId, provider: 'VNPAY_SANDBOX', amount: o.total.toFixed(0), currency: 'VND', state: 'AWAITING', paymentUrl, expiresAt: expiresAt.toISOString() };
                // Existing PROCESSING claims require NULL order_id. Bind before FIX01 journal insertion, atomically.
                await tx.idempotencyRequest.update({ where: { id: claim.id }, data: { orderId, state: 'COMPLETED', responseStatus: 201, responseBody: body, completedAt: now } });
                if (o.status === 'PAYMENT_FAILED') {
                    const cycle = o.redeemedPoints > 0 ? o.reservationCycle + 1 : 0;
                    const changed = await tx.order.updateMany({ where: { id: orderId, userId, status: o.status, version: o.version }, data: { status: 'PENDING', redemptionState: o.redeemedPoints > 0 ? 'RESERVED' : 'NONE', reservationCycle: cycle, version: { increment: 1 }, updatedAt: now } });
                    if (changed.count !== 1)
                        throw conflict();
                    await this.reserveStock(tx, o);
                    if (o.redeemedPoints > 0)
                        await persistEffects(tx, before, account, [effect(account, 'RESERVE', o.redeemedPoints, { orderId, paymentAttemptId: a.id, cycle })]);
                }
                return { body, replayed: false };
            });
        }
        catch (error) {
            if (error instanceof HttpException)
                throw error;
            // Read committed replay after rollback only; never repeat the financial transaction.
            try {
                const replay = await this.transaction(async (tx) => { await this.owned(tx, userId, orderId); return tx.idempotencyRequest.findUnique({ where }); });
                if (replay) {
                    const body = replay.responseBody as { expiresAt?: string } | null;
                    if (body?.expiresAt && new Date(body.expiresAt) <= new Date()) throw new ConflictException({ code: 'PAYMENT_TIMEOUT', message: 'Payment link expired' });
                    return replayResult(replay, hash);
                }
            }
            catch (recovery) {
                if (recovery instanceof HttpException)
                    throw recovery;
            }
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                const adapter = error.meta?.driverAdapterError as {
                    cause?: {
                        originalCode?: string;
                    };
                } | undefined;
                const state = typeof error.meta?.code === 'string' ? error.meta.code : adapter?.cause?.originalCode;
                if (['P2002', 'P2028', 'P2034'].includes(error.code) || ['55P03', '57014', '40P01', '40001'].includes(state ?? ''))
                    throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Retry the same key later' });
            }
            throw unavailable();
        }
    }
    private async canRetry(tx: Prisma.TransactionClient, o: Order, a: Attempt | null, blocks: Blocks) {
        if ((o.paymentExpiresAt && o.paymentExpiresAt <= new Date()) || !this.enabled() || !acceptsNewPayments(this.config) || belowVnpayMinimum(o.total) || blocks.review || blocks.pending || blocks.receipt || !this.retryEligible(o, a))
            return false;
        const account = await reconcileAccount(tx, o.userId);
        if (o.redeemedPoints > 0 && (account.debt > 0n || account.available < BigInt(o.redeemedPoints)))
            return false;
        const demand = new Map<string, number>();
        for (const i of o.items)
            demand.set(i.productId, (demand.get(i.productId) ?? 0) + i.qty);
        const products = await tx.product.findMany({ where: { id: { in: [...demand.keys()] } }, select: { id: true, stock: true, version: true } });
        return products.length === demand.size && products.every(p => p.stock >= demand.get(p.id)! && p.version < maxInt);
    }
    private status(a: Attempt, o: Order, latest: Attempt | null, blocks: Blocks, retry: boolean, now: Date) {
        const paid = ['PAID', 'PREPARING', 'READY', 'COMPLETED'].includes(o.status) || (o.status === 'CANCELLED' && !!o.paidAt);
        const success = terminalBound(a, o, true) && paid;
        const inconsistent = (a.applicationState === 'APPLIED' && !terminalBound(a, o, false) && !success);
        const requiresReview = blocks.review || a.applicationState === 'REVIEW' || inconsistent;
        const effectiveState = requiresReview ? 'REVIEW' : success ? 'SUCCEEDED' : terminalBound(a, o, false) ? 'FAILED'
            : a.state === 'AWAITING' && a.expiresAt > now ? 'AWAITING' : 'UNKNOWN';
        return { attemptId: a.id, orderId: o.id, provider: a.provider, amount: a.amount.toFixed(0), currency: a.currency.trim(), providerState: a.state,
            applicationState: a.applicationState, effectiveState, expiresAt: a.expiresAt.toISOString(), serverNow: now.toISOString(), verifiedAt: a.verifiedAt?.toISOString() ?? null,
            appliedAt: a.appliedAt?.toISOString() ?? null, paymentId: a.payment?.id ?? null, orderStatus: o.status,
            ...(effectiveState === 'FAILED' && !requiresReview && latest?.id === a.id && !blocks.pending && !blocks.receipt
                && ['PAYMENT_FAILED', 'CANCELLED'].includes(o.status) && !o.paidAt && a.responseCode === '24' && a.transactionStatus === '02'
                && a.verifications.some(v => v.state === 'VERIFIED' && v.processedAt !== null && v.payload && typeof v.payload === 'object'
                    && !Array.isArray(v.payload) && v.payload.responseCode === '24' && v.payload.transactionStatus === '02')
                ? { failureReason: 'CUSTOMER_CANCELLED' as const } : {}),
            canResume: this.enabled() && acceptsNewPayments(this.config) && !belowVnpayMinimum(o.total) && latest?.id === a.id && o.status === 'PENDING' && !requiresReview && !blocks.receipt && a.applicationState === 'PENDING' && effectiveState === 'AWAITING' && !a.payment,
            canRetry: latest?.id === a.id && !requiresReview && retry,
            canCancel: ['PENDING', 'PAYMENT_FAILED'].includes(o.status) && !requiresReview && !blocks.pending && !blocks.receipt,
            requiresReview, cashRefundStatus: 'NOT_PROCESSED_BY_BREWLITE',
            ...(requiresReview && (a.state === 'SUCCEEDED' || a.verifications.some(v => v.state === 'VERIFIED' && v.payload && typeof v.payload === 'object'
              && !Array.isArray(v.payload) && v.payload.responseCode === '00' && v.payload.transactionStatus === '00')) ? { messageCode: 'PAYMENT_RECEIVED_REVIEW' } : {}) };
    }
    private async read<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
        try {
            return await this.db.$transaction(async (tx) => { await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY'); return work(tx); }, { isolationLevel: 'RepeatableRead', ...(this.db.transactionOptions ?? { maxWait: 50, timeout: 400 }) });
        }
        catch (error) {
            if (error instanceof HttpException)
                throw error;
            throw unavailable();
        }
    }
    async get(userId: string, id: string) {
        return this.read(async (tx) => {
            const a = await tx.paymentAttempt.findFirst({ where: { id, order: { userId } }, select: attemptSelect });
            if (!a)
                throw new NotFoundException({ code: 'PAYMENT_ATTEMPT_NOT_FOUND', message: 'Payment attempt not found' });
            const o = await this.owned(tx, userId, a.orderId), blocks = await gatewayBlocks(tx, o.id), latest = await this.latest(tx, o.id);
            return this.status(a, o, latest, blocks, await this.canRetry(tx, o, latest, blocks), new Date());
        });
    }
    async resume(userId: string, id: string) {
        return this.transaction(async tx => {
            await this.owned(tx, userId, id);
            await lockUser(tx, userId); await lockOrder(tx, id); await lockAttempts(tx, id);
            const o = await this.owned(tx, userId, id), a = await this.latest(tx, id), blocks = await gatewayBlocks(tx, id);
            assertPaymentWindow(o);
            if (!a || !this.status(a, o, a, blocks, false, new Date()).canResume) throw stateError();
            const claim = await tx.idempotencyRequest.findUniqueOrThrow({ where: { id: a.idempotencyRequestId } });
            const body = claim.responseBody as { paymentUrl?: string; expiresAt?: string } | null;
            if (!body?.paymentUrl || !body.expiresAt || new Date(body.expiresAt) <= new Date()) throw stateError();
            // Return the existing signed URL; no new attempt or new deadline.
            return body;
        });
    }
    async list(userId: string, orderId: string, input: AttemptListDto) {
        const secret = this.config.getOrThrow<string>('JWT_SECRET');
        return this.read(async (tx) => {
            const o = await this.owned(tx, userId, orderId);
            const cursor = input.cursor ? decodeAttemptCursor(secret, userId, orderId, input.cursor) : null;
            const limit = input.limit ? Number(input.limit) : 20;
            const rows = await tx.paymentAttempt.findMany({ where: { orderId, ...(cursor ? { OR: [{ createdAt: { lt: cursor.date } }, { createdAt: cursor.date, id: { lt: cursor.id } }] } : {}) },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, select: attemptSelect });
            const blocks = await gatewayBlocks(tx, o.id), latest = await this.latest(tx, o.id), retry = await this.canRetry(tx, o, latest, blocks), now = new Date();
            const page = rows.slice(0, limit), last = page[page.length - 1];
            return { current: latest ? this.status(latest, o, latest, blocks, retry, now) : null,
                items: page.map(a => this.status(a, o, latest, blocks, retry, now)), nextCursor: rows.length > limit ? encodeAttemptCursor(secret, userId, orderId, last.createdAt, last.id) : null };
        });
    }
}

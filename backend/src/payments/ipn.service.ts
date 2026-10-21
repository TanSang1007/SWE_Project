import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { lockUser } from '../orders/order-policy';
import { effect, lockOrder, persistEffects, reconcileAccount, type Effect } from '../loyalty/loyalty-accounting';
import { lockAttempts } from './gateway-policy';
import { authenticateIpn, IpnRejection, providerPaidAt, verifyIpn } from './vnpay/ipn-verification';
import { buildPaymentUrl, interpretPayStatus, toVnpayAmount } from './vnpay/vnpay-pay';
import { canonicalize, parseRawQuery } from './vnpay/vnpay-signing';
import type { VnpayConfig } from './vnpay/vnpay-config';
import { queryDrOutcome } from './vnpay/querydr-protocol';
export const ipnAck = (code: string) => ({ RspCode: code, Message: ({ '00': 'Confirm Success', '02': 'Order already confirmed', '01': 'Order not found', '04': 'Invalid amount', '97': 'Invalid signature', '99': 'Unable to confirm' } as Record<string, string>)[code] ?? 'Unable to confirm' });
class Review extends Error {
    constructor(readonly reason: string) { super('Settlement requires review'); }
}
const maxInt = 2147483647;
const include = { order: { include: { items: { include: { toppings: true } }, payments: true, loyaltyAward: true } }, idempotencyRequest: true };
type Bound = Prisma.PaymentAttemptGetPayload<{
    include: typeof include;
}>;
type Receipt = Prisma.PaymentVerificationGetPayload<object>;
type Evidence = Record<string, string>;
function payload(row: Receipt): Evidence {
    if (!row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload) || Object.values(row.payload).some(v => typeof v !== 'string'))
        throw new Review('INVALID_EVIDENCE');
    return row.payload as Evidence;
}
function outcome(p: Evidence) { return Object.hasOwn(p, 'transactionType') ? queryDrOutcome(p) : interpretPayStatus(p.responseCode, p.transactionStatus, p.transactionNo); }
function terminal(p: Evidence) { return ['SUCCEEDED', 'FAILED'].includes(outcome(p)); }
function equivalent(a: Evidence, b: Evidence) {
    // QueryDr responseCode describes the inquiry. Compare financial meaning across
    // sources; preserve the original strict response-code comparison for two IPNs.
    return outcome(a) === outcome(b) && ['merchantCode', 'txnRef', 'amountMinor', 'transactionStatus', 'transactionNo'].every(k => a[k] === b[k])
        && (Object.hasOwn(a, 'transactionType') || Object.hasOwn(b, 'transactionType') || a.responseCode === b.responseCode);
}
@Injectable()
export class IpnService {
    private readonly logger = new Logger(IpnService.name);
    private nextRejectionLog = 0;
    constructor(private readonly db: PrismaService, private readonly config: ConfigService) { }
    // Internal shared T1/T2 entrypoints; no HTTP handler accepts evidence or config.
    transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
        return this.db.$transaction(async (tx) => {
            await tx.$executeRaw `SELECT set_config('lock_timeout','200ms',true),set_config('statement_timeout','300ms',true),set_config('TimeZone','UTC',true)`;
            return work(tx);
        }, { maxWait: 50, timeout: 400 });
    }
    async locked(tx: Prisma.TransactionClient, id: string) {
        const lookup = await tx.paymentAttempt.findUniqueOrThrow({ where: { id }, select: { order: { select: { id: true, userId: true } } } });
        await lockUser(tx, lookup.order.userId);
        await lockOrder(tx, lookup.order.id);
        await lockAttempts(tx, lookup.order.id);
        await tx.$queryRaw `SELECT v.id FROM payment_verifications v JOIN payment_attempts a ON a.id=v.attempt_id WHERE a.order_id=${lookup.order.id}::uuid ORDER BY v.id FOR UPDATE OF v`;
        const a = await tx.paymentAttempt.findUniqueOrThrow({ where: { id }, include });
        await tx.$queryRaw `SELECT id FROM idempotency_requests WHERE id=${a.idempotencyRequestId}::uuid FOR UPDATE`;
        return a;
    }
    binding(a: Bound, settings: VnpayConfig) {
        const c = a.idempotencyRequest, o = a.order;
        const body = c.responseBody as {
            attemptId?: string;
            orderId?: string;
            provider?: string;
        } | null;
        if (a.provider !== 'VNPAY_SANDBOX' || a.merchantCode !== settings.merchantCode || a.currency.trim() !== 'VND' || !a.amount.equals(o.total)
            || c.userId !== o.userId || c.orderId !== o.id || c.operation !== 'PAY_ORDER' || c.state !== 'COMPLETED' || c.responseStatus !== 201
            || c.requestHash !== createHash('sha256').update(JSON.stringify({ action: 'VNPAY_INITIATE_V1', orderId: o.id })).digest('hex')
            || body?.attemptId !== a.id || body.orderId !== o.id || body.provider !== a.provider)
            throw new IpnRejection('99');
        const p = a.requestParameters as Record<string, string>;
        try {
            const rebuilt = new URL(buildPaymentUrl(settings, { txnRef: a.txnRef, orderTotalVnd: a.amount.toFixed(0), createDate: a.createDate,
                expireDate: p.vnp_ExpireDate, customerIp: p.vnp_IpAddr }));
            const unsigned = parseRawQuery(rebuilt.search.slice(1));
            delete unsigned.vnp_SecureHash;
            if (canonicalize(unsigned) !== canonicalize(p))
                throw Error();
        }
        catch {
            throw new IpnRejection('99');
        }
    }
    async receive(raw: string) {
        if (this.config.get<string>('PAYMENT_PROVIDER_MODE') !== 'VNPAY_SANDBOX')
            return ipnAck('99');
        const settings = this.config.get<VnpayConfig>('VNPAY_INITIATION_CONFIG');
        if (!settings)
            return ipnAck('99');
        try {
            const fields = authenticateIpn(raw, settings);
            const lookup = await this.db.paymentAttempt.findUnique({ where: { txnRef: fields.vnp_TxnRef }, select: { id: true } });
            if (!lookup)
                throw new IpnRejection('01');
            const receipt = await this.transaction(async (tx) => {
                const a = await this.locked(tx, lookup.id);
                this.binding(a, settings);
                if (fields.vnp_Amount !== toVnpayAmount(a.amount.toFixed(0)))
                    throw new IpnRejection('04');
                const verified = verifyIpn(raw, settings, a.txnRef, a.amount.toFixed(0));
                if (fields.vnp_OrderInfo !== (a.requestParameters as Record<string, string>).vnp_OrderInfo)
                    throw new IpnRejection('99');
                const where = { attemptId_source_payloadHash: { attemptId: a.id, source: 'IPN' as const, payloadHash: verified.hash } };
                const prior = await tx.paymentVerification.findUnique({ where });
                return prior ?? tx.paymentVerification.create({ data: { attemptId: a.id, source: 'IPN', state: 'VERIFIED', payload: verified.payload, payloadHash: verified.hash, verifiedAt: new Date() } });
            }); // T1 commits independently, without any financial mutation.
            return await this.apply(receipt.id, settings);
        }
        catch (error) {
            // At most one fixed diagnostic per minute; no public raw-query log sink.
            const now = Date.now();
            if (now >= this.nextRejectionLog) {
                this.nextRejectionLog = now + 60000;
                this.logger.warn('VNPAY_IPN_REJECTED');
            }
            return ipnAck(error instanceof IpnRejection ? error.code : '99');
        }
    }
    private async selected(tx: Prisma.TransactionClient, id: string, settings: VnpayConfig) {
        const r = await tx.paymentVerification.findUniqueOrThrow({ where: { id } });
        const a = await this.locked(tx, r.attemptId);
        this.binding(a, settings);
        const receipts = await tx.paymentVerification.findMany({ where: { attemptId: a.id, state: 'VERIFIED' }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] });
        for (const item of receipts) {
            const p = payload(item);
            if (p.merchantCode !== a.merchantCode || p.txnRef !== a.txnRef || p.amountMinor !== toVnpayAmount(a.amount.toFixed(0)))
                throw new Review('EVIDENCE_BINDING');
            if ((item.source === 'QUERYDR') !== Object.hasOwn(p, 'transactionType'))
                throw new Review('EVIDENCE_SOURCE');
        }
        return { a, receipts, target: receipts.find(item => item.id === id)! };
    }
    private async processed(tx: Prisma.TransactionClient, rows: Receipt[], now: Date) {
        await tx.paymentVerification.updateMany({ where: { id: { in: rows.filter(r => !r.processedAt).map(r => r.id) }, processedAt: null }, data: { processedAt: now } });
    }
    private async providerFields(tx: Prisma.TransactionClient, a: Bound, p: Evidence) {
        const number = /[1-9]/.test(p.transactionNo) ? p.transactionNo : null;
        if (a.transactionNo && a.transactionNo !== number)
            throw new Review('PROVIDER_IDENTIFIER_CONFLICT');
        if (number) {
            const taken = await tx.paymentAttempt.findUnique({ where: { merchantCode_transactionNo: { merchantCode: a.merchantCode, transactionNo: number } }, select: { id: true } });
            if (taken && taken.id !== a.id)
                throw new Review('PROVIDER_TRANSACTION_REUSED');
            // Contradictory REVIEW can retain an additional number only in evidence.
            // It must not become available for settlement on another reference.
            const foreignEvidence = await tx.paymentVerification.findFirst({ where: { attemptId: { not: a.id }, state: 'VERIFIED', AND: [
                { payload: { path: ['merchantCode'], equals: a.merchantCode } },
                { payload: { path: ['transactionNo'], equals: number } },
            ] }, select: { id: true } });
            if (foreignEvidence)
                throw new Review('PROVIDER_TRANSACTION_REUSED');
        }
        return { state: outcome(p) === 'REVIEW' ? 'UNKNOWN' as const : outcome(p) as 'UNKNOWN' | 'SUCCEEDED' | 'FAILED', transactionNo: number, responseCode: p.responseCode,
            transactionStatus: p.transactionStatus, providerPaidAt: providerPaidAt(p.payDate), verifiedAt: new Date() };
    }
    private async review(id: string, settings: VnpayConfig, reason: string, uniqueOnly = false) {
        return this.transaction(async (tx) => {
            const { a, receipts, target } = await this.selected(tx, id, settings);
            if (uniqueOnly) {
                const p = payload(target), taken = await tx.paymentAttempt.findUnique({ where: { merchantCode_transactionNo: { merchantCode: a.merchantCode, transactionNo: p.transactionNo } }, select: { id: true } });
                if (!taken || taken.id === a.id)
                    throw Error('No durable uniqueness conflict');
            }
            if (target.processedAt && a.applicationState === 'REVIEW')
                return ipnAck('02');
            // Preserve a previously selected/applied result; all contradictory evidence stays separate.
            let fields: Prisma.PaymentAttemptUpdateInput = {};
            if (!a.verifiedAt || a.state === 'AWAITING' || a.state === 'UNKNOWN') {
                const chosen = receipts.map(payload).find(terminal) ?? payload(target);
                if (a.transactionNo && a.transactionNo !== chosen.transactionNo) {
                    // Keep the original selected identifier bound even in REVIEW.
                    fields = {};
                } else try {
                    fields = await this.providerFields(tx, a, chosen);
                }
                catch (error) {
                    if (!(error instanceof Review))
                        throw error;
                    // A foreign transaction number remains in evidence, never assigned here.
                    const result = outcome(chosen);
                    fields = { state: result === 'REVIEW' ? 'UNKNOWN' : result, responseCode: chosen.responseCode,
                        transactionStatus: chosen.transactionStatus, verifiedAt: new Date(), providerPaidAt: providerPaidAt(chosen.payDate) };
                }
            }
            await tx.paymentAttempt.update({ where: { id: a.id }, data: { ...fields, applicationState: 'REVIEW', reviewReason: reason } });
            await this.processed(tx, receipts, new Date());
            return ipnAck('00');
        });
    }
    async apply(id: string, settings: VnpayConfig) {
        try {
            return await this.transaction(async (tx) => {
                const { a, receipts, target } = await this.selected(tx, id, settings), o = a.order;
                if (target.processedAt)
                    return ipnAck('02');
                if (a.applicationState === 'REVIEW')
                    throw new Review(a.reviewReason ?? 'PREVIOUS_REVIEW');
                const evidence = receipts.map(payload), terminals = evidence.filter(terminal), chosen = terminals[0] ?? payload(target);
                const identifiers = new Set(evidence.filter(p => /[1-9]/.test(p.transactionNo)).map(p => p.transactionNo));
                if (identifiers.size > 1)
                    throw new Review('PROVIDER_IDENTIFIER_CONFLICT');
                if (evidence.some(p => outcome(p) === 'REVIEW') || terminals.some(p => !equivalent(p, chosen)))
                    throw new Review('PROVIDER_CONTRADICTION');
                const result = outcome(chosen);
                if (a.applicationState === 'APPLIED') {
                    if (outcome(payload(target)) === 'UNKNOWN')
                        throw new Review('TERMINAL_CONTRADICTION');
                    if (!terminals.length || a.state !== result || a.responseCode !== chosen.responseCode || a.transactionStatus !== chosen.transactionStatus
                        || a.transactionNo !== (/[1-9]/.test(chosen.transactionNo) ? chosen.transactionNo : null))
                        throw new Review('TERMINAL_CONTRADICTION');
                    const payment = o.payments.find(p => p.gatewayAttemptId === a.id);
                    if (!payment || payment.status !== result || payment.userId !== o.userId || payment.orderId !== o.id || !payment.amount.equals(a.amount)
                        || payment.provider !== 'VNPAY_SANDBOX' || payment.method !== 'VNPAY' || !payment.confirmedAt
                        || payment.idempotencyKey !== a.idempotencyRequest.idempotencyKey || payment.idempotencyRequestId !== a.idempotencyRequestId)
                        throw new Review('PAYMENT_BINDING');
                    await this.processed(tx, receipts, new Date());
                    return ipnAck('02');
                }
                const otherReview = await tx.paymentAttempt.findFirst({ where: { orderId: o.id, id: { not: a.id }, applicationState: 'REVIEW' }, select: { id: true } });
                const otherReceipt = await tx.paymentVerification.findFirst({ where: { attempt: { orderId: o.id, id: { not: a.id } }, state: 'VERIFIED', processedAt: null }, select: { id: true } });
                if (otherReview || otherReceipt)
                    throw new Review('ORDER_REQUIRES_REVIEW');
                const fields = await this.providerFields(tx, a, chosen);
                if (result === 'UNKNOWN') {
                    await tx.paymentAttempt.update({ where: { id: a.id }, data: fields });
                    return ipnAck('99'); // Hold resources; not an applied/review ACK.
                }
                const latest = await tx.paymentAttempt.findFirst({ where: { orderId: o.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
                if (o.status !== 'PENDING' || latest?.id !== a.id || o.version >= maxInt || o.payments.some(p => p.status === 'SUCCEEDED') || o.loyaltyAward
                    || o.payments.some(p => p.gatewayAttemptId === a.id))
                    throw new Review('ORDER_FINANCIAL_STATE');
                const before = await reconcileAccount(tx, o.userId), account = { ...before };
                if (o.redeemedPoints > 0 && (o.redemptionState !== 'RESERVED' || o.reservationCycle < 1))
                    throw new Review('RESERVATION_STATE');
                if (result === 'SUCCEEDED' && o.redeemedPoints > 0 && account.debt > 0n)
                    throw new Review('LOYALTY_DEBT');
                const cart = result === 'SUCCEEDED' ? await tx.cart.findUnique({ where: { userId: o.userId }, include: { items: true } }) : null;
                const purchased: {
                    id: string;
                    remaining: number;
                }[] = [];
                if (result === 'SUCCEEDED') {
                    if (!cart)
                        throw new Review('CART_INVARIANT');
                    const quantities = new Map<string, number>();
                    for (const item of o.items) {
                        const key = [item.productId, item.size, ...item.toppings.map(t => t.toppingId).sort()].join(':');
                        quantities.set(key, (quantities.get(key) ?? 0) + item.qty);
                    }
                    for (const [key, qty] of quantities) {
                        const row = cart.items.find(i => i.configurationKey === key);
                        if (!row || row.qty < qty)
                            throw new Review('CART_INVARIANT');
                        purchased.push({ id: row.id, remaining: row.qty - qty });
                    }
                }
                const now = new Date(), success = result === 'SUCCEEDED';
                if (!success) {
                    const demand = new Map<string, number>();
                    for (const i of o.items)
                        demand.set(i.productId, (demand.get(i.productId) ?? 0) + i.qty);
                    for (const [productId, qty] of [...demand].sort(([x], [y]) => x.localeCompare(y))) {
                        const p = await tx.product.findUnique({ where: { id: productId } });
                        if (!p || p.stock > maxInt - qty || p.version >= maxInt)
                            throw new Review('STOCK_INVARIANT');
                        const updated = await tx.product.updateMany({ where: { id: productId, version: p.version }, data: { stock: { increment: qty }, version: { increment: 1 }, updatedAt: now } });
                        if (updated.count !== 1)
                            throw Error('Concurrent stock update');
                    }
                }
                const changed = await tx.order.updateMany({ where: { id: o.id, userId: o.userId, status: 'PENDING', version: o.version }, data: { status: success ? 'PAID' : 'PAYMENT_FAILED',
                        redemptionState: o.redeemedPoints ? success ? 'SETTLED' : 'RELEASED' : 'NONE', ...(success ? { paidAt: now } : {}), version: { increment: 1 }, updatedAt: now } });
                if (changed.count !== 1)
                    throw Error('Concurrent settlement');
                await tx.paymentAttempt.update({ where: { id: a.id }, data: { ...fields, applicationState: 'APPLIED', appliedAt: now } });
                await this.processed(tx, receipts, now);
                const payment = await tx.payment.create({ data: { orderId: o.id, userId: o.userId, idempotencyRequestId: a.idempotencyRequestId, idempotencyKey: a.idempotencyRequest.idempotencyKey,
                        amount: a.amount, provider: 'VNPAY_SANDBOX', method: 'VNPAY', gatewayAttemptId: a.id, status: success ? 'SUCCEEDED' : 'FAILED', failureCode: success ? null : 'VNPAY_DECLINED', confirmedAt: now } });
                const effects: Effect[] = [];
                if (o.redeemedPoints)
                    effects.push(effect(account, success ? 'SETTLE' : 'RELEASE', o.redeemedPoints, { orderId: o.id, paymentId: payment.id, cycle: o.reservationCycle }));
                if (success) {
                    const points = o.total.dividedBy(10000).floor().toNumber();
                    await tx.loyaltyAward.create({ data: { orderId: o.id, userId: o.userId, points } });
                    effects.push(effect(account, 'EARN', points, { orderId: o.id, paymentId: payment.id }));
                    for (const row of purchased) {
                        if (row.remaining)
                            await tx.cartItem.update({ where: { id: row.id }, data: { qty: row.remaining } });
                        else
                            await tx.cartItem.delete({ where: { id: row.id } });
                    }
                    await tx.cart.update({ where: { id: cart!.id }, data: { updatedAt: now } });
                }
                if (effects.length)
                    await persistEffects(tx, before, account, effects);
                return ipnAck('00');
            });
        }
        catch (error) {
            if (error instanceof Review)
                return this.review(id, settings, error.reason);
            if (error instanceof ServiceUnavailableException)
                return this.review(id, settings, 'LOYALTY_INVARIANT');
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
                return this.review(id, settings, 'PROVIDER_TRANSACTION_REUSED', true);
            throw error;
        }
    }
}

import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type LoyaltyEntryKind } from '../generated/prisma/client';
export const maxPoints = 2147483647n;
const maxDebt = 9223372036854775807n;
export const accountingFault = () => new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Loyalty accounting is unavailable' });
export type Effect = {
    kind: LoyaltyEntryKind;
    points: number;
    cycle: number;
    orderId: string;
    paymentId: string | null;
    paymentAttemptId?: string;
    effectKey: string;
    availableDelta: number;
    reservedDelta: number;
    debtDelta: bigint;
};
export type Account = {
    userId: string;
    available: bigint;
    debt: bigint;
    reserved: bigint;
};
export async function lockOrder(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw `SELECT id FROM orders WHERE id=${id}::uuid FOR UPDATE`;
}
function check(condition: boolean) {
    if (!condition)
        throw accountingFault();
}


export async function reconcileAccount(tx: Prisma.TransactionClient, userId: string): Promise<Account> {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { loyaltyPoints: true, loyaltyDebt: true } });
    const entries = await tx.loyaltyEntry.findMany({ where: { userId }, orderBy: { sequence: 'asc' } });
    const orders = await tx.order.findMany({ where: { userId }, include: { loyaltyAward: true, payments: true, paymentAttempts: true } });
    let a = 0n, d = 0n, r = 0n, opening = 0n, earned = 0n, spent = 0n, refunded = 0n, reversed = 0n;
    const byOrder = new Map(orders.map(o => [o.id, o]));
    const grouped = new Map<string, typeof entries>();
    check(orders.filter(o => o.status === 'PENDING' || o.status === 'PAYMENT_FAILED').length <= 1);
    for (const e of entries) {
        const n = BigInt(e.points);
        if (e.kind === 'OPENING')
            check(a === 0n && d === 0n && r === 0n && !entries.some(x => x.sequence < e.sequence));
        else if (['EARN', 'RELEASE', 'REFUND'].includes(e.kind))
            check(-e.debtDelta === (d < n ? d : n));
        else if (e.kind === 'REVERSE')
            check(-BigInt(e.availableDelta) === (a < n ? a : n));
        else if (e.kind === 'RESERVE')
            check(d === 0n && a >= n);
        else if (e.kind === 'SETTLE')
            check(d === 0n && r >= n);
        a += BigInt(e.availableDelta);
        d += e.debtDelta;
        r += BigInt(e.reservedDelta);
        check(a >= 0n && d >= 0n && r >= 0n && (a === 0n || d === 0n));
        if (e.kind === 'OPENING') {
            opening += BigInt(e.points);
            continue;
        }
        const o = e.orderId ? byOrder.get(e.orderId) : undefined;
        check(!!o);
        if (!o)
            throw accountingFault();
        const rows = grouped.get(o.id) ?? [];
        rows.push(e);
        grouped.set(o.id, rows);
        const p = e.paymentId ? o.payments.find(p => p.id === e.paymentId) : undefined;
        if (e.paymentId)
            check(!!p && p.userId === userId && p.amount.equals(o.total));
        if (e.paymentAttemptId) {
            const attempt = o.paymentAttempts.find(a => a.id === e.paymentAttemptId);
            check(e.kind === 'RESERVE' && e.cycle > 1 && !e.paymentId && !!attempt
                && attempt.provider === 'VNPAY_SANDBOX' && attempt.amount.equals(o.total)
                && e.effectKey === `GATEWAY_ATTEMPT:${e.paymentAttemptId}`);
        }
        if (['RESERVE', 'SETTLE', 'RELEASE', 'REFUND'].includes(e.kind))
            check(e.points === o.redeemedPoints);
        if (e.kind === 'EARN' || e.kind === 'REVERSE')
            check(!!o.loyaltyAward && o.loyaltyAward.userId === userId && e.points === o.loyaltyAward.points);
        if (e.kind === 'EARN' || e.kind === 'SETTLE')
            check(p?.status === 'SUCCEEDED');
        if (e.kind === 'RELEASE' && p)
            check(p.status === 'FAILED');
        if (e.kind === 'REVERSE')
            check(o.status === 'CANCELLED' && o.loyaltyAward?.reversedAt !== null);
        if (e.kind === 'REFUND')
            check(o.redemptionState === 'REFUNDED');
        if (e.kind === 'EARN')
            earned += BigInt(e.points);
        if (e.kind === 'SETTLE')
            spent += BigInt(e.points);
        if (e.kind === 'REFUND')
            refunded += BigInt(e.points);
        if (e.kind === 'REVERSE')
            reversed += BigInt(e.points);
    }
    let held = 0n;
    for (const o of orders) {
        const rows = grouped.get(o.id) ?? [];
        for (const payment of o.payments)
            check(payment.userId === userId && payment.amount.equals(o.total));
        if (o.loyaltyAward)
            check(o.loyaltyAward.userId === userId);
        const openingEntry = entries.find(e => e.kind === 'OPENING');
        const legacyAward = o.redeemedPoints === 0 && !!openingEntry && !!o.loyaltyAward && o.loyaltyAward.createdAt <= openingEntry.createdAt;
        const earns = rows.filter(e => e.kind === 'EARN');
        if (o.loyaltyAward && !legacyAward)
            check(earns.length === 1);
        if (!o.loyaltyAward)
            check(earns.length === 0);
        if (o.redeemedPoints === 0) {
            check(o.redemptionState === 'NONE' && o.reservationCycle === 0);
            continue;
        }
        check(o.reservationCycle >= 1);
        const reserves = rows.filter(e => e.kind === 'RESERVE');
        check(reserves.length === o.reservationCycle);
        for (const reserve of reserves) {
            check(reserve.cycle <= o.reservationCycle);
            const release = rows.filter(e => e.kind === 'RELEASE' && e.cycle === reserve.cycle);
            const settle = rows.filter(e => e.kind === 'SETTLE' && e.cycle === reserve.cycle);
            if (reserve.paymentAttemptId) {
                for (const terminal of [...release, ...settle]) {
                    const payment = o.payments.find(p => p.id === terminal.paymentId);
                    check(!!payment && payment.provider === 'VNPAY_SANDBOX'
                        && payment.gatewayAttemptId === reserve.paymentAttemptId);
                }
            }
            if (reserve.cycle < o.reservationCycle)
                check(release.length === 1 && settle.length === 0 && !!release[0].paymentId);
            else if (o.redemptionState === 'RESERVED')
                check(release.length === 0 && settle.length === 0 && o.status === 'PENDING');
            else if (o.redemptionState === 'RELEASED')
                check(release.length === 1 && settle.length === 0);
            else
                check(settle.length === 1 && release.length === 0);
        }
        check(rows.filter(e => e.kind === 'REFUND').length === (o.redemptionState === 'REFUNDED' ? 1 : 0));
        if (o.redemptionState === 'SETTLED' || o.redemptionState === 'REFUNDED') {
            check(rows.filter(e => e.kind === 'EARN').length === 1 && !!o.loyaltyAward);
            check(rows.filter(e => e.kind === 'REVERSE').length === (o.redemptionState === 'REFUNDED' ? 1 : 0));
        }
        if (o.redemptionState === 'RESERVED')
            held += BigInt(o.redeemedPoints);
    }
    check(a === BigInt(user.loyaltyPoints) && d === user.loyaltyDebt && r === held && held <= maxPoints && a >= 0n && d >= 0n && r >= 0n && (a === 0n || d === 0n));
    check(a + r - d === opening + earned - spent + refunded - reversed);
    return { userId, available: a, debt: d, reserved: r };
}
export function validateRedemption(account: Account, points: number, totalAfterPromotion: Prisma.Decimal) {
    if (!Number.isInteger(points) || points < 0 || BigInt(points) > maxPoints)
        throw accountingFault();
    if (points > 0 && account.debt > 0n)
        throw new ConflictException({ code: 'LOYALTY_REVERSAL_OUTSTANDING', message: 'Huy don hang chua thanh toan de hoan lai diem thuong cho giao dich dao nguoc chua xu ly' });
    if (BigInt(points) > account.available)
        throw new ConflictException({ code: 'LOYALTY_INSUFFICIENT_POINTS', message: 'Khong du diem thuong kha dung' });
    const discount = new Prisma.Decimal(points).times(100);
    if (discount.gt(totalAfterPromotion))
        throw new ConflictException({ code: 'LOYALTY_REDEMPTION_EXCEEDS_TOTAL', message: 'So diem da chon vuot qua tong so tien can thanh toan' });
    return { discount, total: totalAfterPromotion.minus(discount) };
}
export function reservationGate(account: Account, points: number) {
    if (points > 0 && account.debt > 0n)
        throw new ConflictException({ code: 'LOYALTY_REVERSAL_OUTSTANDING', message: 'Huy don hang chua thanh toan de hoan lai diem thuong cho giao dich dao nguoc chua xu ly' });
}
type Source = {
    orderId: string;
    paymentId?: string;
    paymentAttemptId?: string;
    cycle?: number;
};
export function effect(account: Account, kind: Exclude<LoyaltyEntryKind, 'OPENING'>, points: number, source: Source): Effect {
    check(Number.isInteger(points) && points >= 0 && points <= 2147483647);
    check(!source.paymentAttemptId || (kind === 'RESERVE' && (source.cycle ?? 1) > 1 && !source.paymentId));
    const n = BigInt(points);
    let availableDelta = 0n, reservedDelta = 0n, debtDelta = 0n;
    if (kind === 'RESERVE') {
        reservationGate(account, points);
        if (account.available < n)
            throw new ConflictException({ code: 'LOYALTY_INSUFFICIENT_POINTS', message: 'Insufficient available loyalty points' });
        availableDelta = -n;
        reservedDelta = n;
    }
    else if (kind === 'SETTLE') {
        reservationGate(account, points);
        check(account.reserved >= n);
        reservedDelta = -n;
    }
    else if (kind === 'REVERSE') {
        const take = account.available < n ? account.available : n;
        availableDelta = -take;
        debtDelta = n - take;
    }
    else {
        const offset = account.debt < n ? account.debt : n;
        availableDelta = n - offset;
        debtDelta = -offset;
        if (kind === 'RELEASE') {
            check(account.reserved >= n);
            reservedDelta = -n;
        }
    }
    account.available += availableDelta;
    account.debt += debtDelta;
    account.reserved += reservedDelta;
    const orderId = source.orderId.toLowerCase(), paymentId = source.paymentId?.toLowerCase() ?? null;
    const paymentAttemptId = source.paymentAttemptId?.toLowerCase();
    const effectKey = paymentAttemptId ? `GATEWAY_ATTEMPT:${paymentAttemptId}` : paymentId ? `PAY_ORDER:${paymentId}` : kind === 'RESERVE' ? `CREATE_ORDER:${orderId}`
        : kind === 'RELEASE' ? `UNPAID_CANCEL:${orderId}` : `PAID_CANCEL:${orderId}`;
    return { kind, points, cycle: ['RESERVE', 'SETTLE', 'RELEASE'].includes(kind) ? source.cycle ?? 1 : 0,
        orderId, paymentId, ...(paymentAttemptId ? { paymentAttemptId } : {}), effectKey,
        availableDelta: Number(availableDelta), reservedDelta: Number(reservedDelta), debtDelta };
}
export async function persistEffects(tx: Prisma.TransactionClient, before: Account, after: Account, effects: Effect[]) {
    check(after.available >= 0n && after.available <= maxPoints && after.debt >= 0n && after.debt <= maxDebt && after.reserved >= 0n && (after.available === 0n || after.debt === 0n));
    const changed = await tx.user.updateMany({ where: { id: before.userId, loyaltyPoints: Number(before.available), loyaltyDebt: before.debt },
        data: { loyaltyPoints: Number(after.available), loyaltyDebt: after.debt, updatedAt: new Date() } });
    check(changed.count === 1);
    for (const row of effects)
        await tx.loyaltyEntry.create({ data: { ...row, userId: before.userId } });
}

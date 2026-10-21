import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import { OrderError } from './orders';
import type { OrderInput } from '../../types/order';
export type LoyaltyBalance = {
    loyaltyPoints: number;
    reservedPoints: number;
    outstandingReversalPoints: string;
    pointValueVnd: '100';
};
export type LoyaltyEntry = {
    kind: 'OPENING' | 'EARN' | 'RESERVE' | 'SETTLE' | 'RELEASE' | 'REFUND' | 'REVERSE';
    orderId: string | null;
    orderCode: string | null;
    points: number;
    availableChange: number;
    reservedChange: number;
    outstandingReversalChange: string;
    debtOffsetPoints: string;
    debtCreatedPoints: string;
    createdAt: string;
};
export type LoyaltyHistory = {
    scope: 'SINCE_L01_CUTOVER';
    items: LoyaltyEntry[];
    nextCursor: string | null;
};
export type OrderPreview = {
    currency: 'VND';
    itemSubtotal: string;
    promotionCode: string | null;
    promotionDiscount: string;
    totalAfterPromotion: string;
    redeemedPoints: number;
    pointValueVnd: '100';
    loyaltyDiscount: string;
    finalTotal: string;
    earnedPoints: number;
    availablePoints: number;
    availablePointsAfterReservation: number;
    reservedPoints: number;
    outstandingReversalPoints: string;
    maxRedeemablePoints: number;
};
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2147483647;
const signed = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 2147483647;
const money = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,11})$/.test(v);
const debt = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const bad = () => new OrderError('UNAVAILABLE');
async function read(path: string, body?: OrderInput, signal?: AbortSignal): Promise<unknown> {
    const token = getAccessToken(), owner = useAuthStore.getState().user?.id;
    if (!token || !owner)
        throw new OrderError('UNAUTHORIZED');
    const current = () => useAuthStore.getState().accessToken === token && useAuthStore.getState().user?.id === owner;
    try {
        const timeout = AbortSignal.timeout(5000);
        const r = await fetch(`${getApiBaseUrl()}${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit',
            headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        if (!current())
            throw new OrderError('UNAUTHORIZED');
        if (r.status === 401) {
            useAuthStore.getState().clear();
            throw new OrderError('UNAUTHORIZED');
        }
        const value = await r.json();
        if (!current())
            throw new OrderError('UNAUTHORIZED');
        if (!r.ok)
            throw new OrderError(value?.error?.code ?? 'UNAVAILABLE');
        return value;
    }
    catch (e) {
        if (e instanceof OrderError)
            throw e;
        throw bad();
    }
}
export function parseLoyaltyBalance(v: unknown): LoyaltyBalance {
    const o = v as LoyaltyBalance;
    if (!o || !integer(o.loyaltyPoints) || !integer(o.reservedPoints) || !debt(o.outstandingReversalPoints) || o.pointValueVnd !== '100'
        || o.loyaltyPoints > 0 && o.outstandingReversalPoints !== '0')
        throw bad();
    return { loyaltyPoints: o.loyaltyPoints, reservedPoints: o.reservedPoints, outstandingReversalPoints: o.outstandingReversalPoints, pointValueVnd: '100' };
}
export function parsePreview(v: unknown): OrderPreview {
    const o = v as OrderPreview;
    if (!o || o.currency !== 'VND' || o.pointValueVnd !== '100' || ![o.itemSubtotal, o.promotionDiscount, o.totalAfterPromotion, o.loyaltyDiscount, o.finalTotal].every(money)
        || ![o.redeemedPoints, o.earnedPoints, o.availablePoints, o.availablePointsAfterReservation, o.reservedPoints, o.maxRedeemablePoints].every(integer) || !debt(o.outstandingReversalPoints)
        || !(o.promotionCode === null || typeof o.promotionCode === 'string') || BigInt(o.itemSubtotal) - BigInt(o.promotionDiscount) !== BigInt(o.totalAfterPromotion)
        || BigInt(o.redeemedPoints) * 100n !== BigInt(o.loyaltyDiscount) || BigInt(o.totalAfterPromotion) - BigInt(o.loyaltyDiscount) !== BigInt(o.finalTotal)
        || BigInt(o.finalTotal) / 10000n !== BigInt(o.earnedPoints) || o.availablePoints - o.redeemedPoints !== o.availablePointsAfterReservation
        || o.maxRedeemablePoints !== (o.outstandingReversalPoints !== '0' ? 0 : Math.min(o.availablePoints, Number(BigInt(o.totalAfterPromotion) / 100n))))
        throw bad();
    return { currency: 'VND', pointValueVnd: '100', itemSubtotal: o.itemSubtotal, promotionCode: o.promotionCode, promotionDiscount: o.promotionDiscount, totalAfterPromotion: o.totalAfterPromotion,
        redeemedPoints: o.redeemedPoints, loyaltyDiscount: o.loyaltyDiscount, finalTotal: o.finalTotal, earnedPoints: o.earnedPoints, availablePoints: o.availablePoints,
        availablePointsAfterReservation: o.availablePointsAfterReservation, reservedPoints: o.reservedPoints, outstandingReversalPoints: o.outstandingReversalPoints, maxRedeemablePoints: o.maxRedeemablePoints };
}
export function parseLoyaltyHistory(v: unknown): LoyaltyHistory {
    const o = v as LoyaltyHistory;
    if (!o || o.scope !== 'SINCE_L01_CUTOVER' || !Array.isArray(o.items) || o.items.length > 50
        || !(o.nextCursor === null || typeof o.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(o.nextCursor)))
        throw bad();
    const items = o.items.map(e => {
        if (!e || !['OPENING', 'EARN', 'RESERVE', 'SETTLE', 'RELEASE', 'REFUND', 'REVERSE'].includes(e.kind) || !integer(e.points) || !signed(e.availableChange) || !signed(e.reservedChange)
            || typeof e.outstandingReversalChange !== 'string' || !/^(0|-?[1-9]\d{0,18})$/.test(e.outstandingReversalChange) || !debt(e.debtOffsetPoints) || !debt(e.debtCreatedPoints)
            || typeof e.createdAt !== 'string' || !Number.isFinite(Date.parse(e.createdAt)) || !(e.kind === 'OPENING' ? e.orderId === null && e.orderCode === null : typeof e.orderId === 'string' && /^[0-9a-f-]{36}$/i.test(e.orderId) && typeof e.orderCode === 'string'))
            throw bad();
        const delta = BigInt(e.outstandingReversalChange);
        if (BigInt(e.debtOffsetPoints) !== (delta < 0n ? -delta : 0n) || BigInt(e.debtCreatedPoints) !== (delta > 0n ? delta : 0n))
            throw bad();
        return { kind: e.kind, orderId: e.orderId, orderCode: e.orderCode, points: e.points, availableChange: e.availableChange, reservedChange: e.reservedChange, outstandingReversalChange: e.outstandingReversalChange, debtOffsetPoints: e.debtOffsetPoints, debtCreatedPoints: e.debtCreatedPoints, createdAt: e.createdAt };
    });
    return { scope: 'SINCE_L01_CUTOVER', items, nextCursor: o.nextCursor };
}
export async function getLoyaltyBalance(signal?: AbortSignal) { return parseLoyaltyBalance(await read('/loyalty', undefined, signal)); }
export async function getLoyaltyHistory(cursor?: string, signal?: AbortSignal) { return parseLoyaltyHistory(await read('/loyalty/transactions?limit=20' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), undefined, signal)); }
export async function previewOrder(body: OrderInput, signal?: AbortSignal) {
    const result = parsePreview(await read('/orders/preview', body, signal));
    if (result.redeemedPoints !== (body.redeemedPoints ?? 0))
        throw bad();
    return result;
}

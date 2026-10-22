import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import { OrderError } from './orders';

export type ProviderMode = 'MOCK' | 'VNPAY_SANDBOX';
export interface AttemptStatus {
  expiresAt?: string; serverNow?: string; attemptId: string; orderId: string; amount: string; currency: 'VND'; provider: 'VNPAY_SANDBOX';
  effectiveState: 'AWAITING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'REVIEW';
  applicationState: 'PENDING' | 'APPLIED' | 'REVIEW'; orderStatus: string; paymentId: string | null;
  canResume: boolean; canRetry: boolean; canCancel: boolean; requiresReview: boolean; messageCode?: string;
  failureReason?: 'CUSTOMER_CANCELLED';
}
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
async function request(path: string, method = 'GET', body?: object, key?: string, signal?: AbortSignal): Promise<unknown> {
  const token = getAccessToken(); if (!token) throw new OrderError('UNAUTHORIZED');
  try {
    const r = await fetch(getApiBaseUrl() + path, { method, cache: 'no-store', credentials: 'omit',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (r.status === 401) { if (useAuthStore.getState().accessToken === token) useAuthStore.getState().clear(); throw new OrderError('UNAUTHORIZED'); }
    const v = await r.json();
    if (useAuthStore.getState().accessToken !== token) throw new OrderError('UNAUTHORIZED');
    if (!r.ok) throw new OrderError(v?.error?.code ?? 'UNAVAILABLE');
    return v;
  } catch (e) { if (e instanceof OrderError) throw e; throw new OrderError('UNAVAILABLE'); }
}
export async function paymentConfiguration(signal?: AbortSignal): Promise<{ providerMode: ProviderMode; acceptingNewPayments: boolean }> {
  const v = await request('/payments/config', 'GET', undefined, undefined, signal) as { providerMode?: unknown; acceptingNewPayments?: unknown };
  if (!v || Object.keys(v).some(k => !['providerMode', 'acceptingNewPayments'].includes(k))
    || !['MOCK', 'VNPAY_SANDBOX'].includes(String(v.providerMode))
    || (Object.hasOwn(v, 'acceptingNewPayments') && (v.providerMode !== 'VNPAY_SANDBOX' || typeof v.acceptingNewPayments !== 'boolean'))) throw new OrderError('UNAVAILABLE');
  return { providerMode: v.providerMode as ProviderMode, acceptingNewPayments: v.acceptingNewPayments !== false };
}
export async function paymentConfig(signal?: AbortSignal): Promise<ProviderMode> {
  return (await paymentConfiguration(signal)).providerMode;
}
export function parseAttempt(v: unknown): AttemptStatus {
  const a = v as AttemptStatus;
  if (!a || !uuid(a.attemptId) || !uuid(a.orderId) || a.provider !== 'VNPAY_SANDBOX' || a.currency !== 'VND'
    || typeof a.amount !== 'string' || !/^[1-9]\d{0,11}$/.test(a.amount)
    || !['AWAITING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'REVIEW'].includes(a.effectiveState)
    || !['PENDING', 'APPLIED', 'REVIEW'].includes(a.applicationState)
    || !['PENDING', 'PAYMENT_FAILED', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'].includes(a.orderStatus)
    || ![a.canResume, a.canRetry, a.canCancel, a.requiresReview].every(x => typeof x === 'boolean')
    || !(a.paymentId === null || uuid(a.paymentId))) throw new OrderError('UNAVAILABLE');
  if (a.effectiveState === 'SUCCEEDED' && (a.applicationState !== 'APPLIED' || !a.paymentId || !['PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'].includes(a.orderStatus))) throw new OrderError('UNAVAILABLE');
  if (a.effectiveState === 'FAILED' && (a.applicationState !== 'APPLIED' || !a.paymentId)) throw new OrderError('UNAVAILABLE');
  if (a.failureReason !== undefined && (a.failureReason !== 'CUSTOMER_CANCELLED' || a.effectiveState !== 'FAILED'
    || a.requiresReview || a.applicationState !== 'APPLIED' || !a.paymentId || !['PAYMENT_FAILED', 'CANCELLED'].includes(a.orderStatus))) throw new OrderError('UNAVAILABLE');
  return a;
}
export async function attemptStatus(id: string, signal?: AbortSignal) {
  if (!uuid(id)) throw new OrderError('INVALID_CONTEXT');
  const a = parseAttempt(await request('/payments/attempts/' + id, 'GET', undefined, undefined, signal));
  if (a.attemptId !== id) throw new OrderError('UNAVAILABLE'); return a;
}
export async function currentAttempt(orderId: string, signal?: AbortSignal) {
  if (!uuid(orderId)) throw new OrderError('INVALID_CONTEXT');
  const v = await request('/orders/' + orderId + '/payment-attempts?limit=1', 'GET', undefined, undefined, signal) as { current: unknown };
  if (!v || !Object.hasOwn(v, 'current')) throw new OrderError('UNAVAILABLE');
  if (v.current === null) return null;
  const a = parseAttempt(v.current); if (a.orderId !== orderId) throw new OrderError('UNAVAILABLE'); return a;
}
// Same exact host/path as backend P00 SANDBOX_PAYMENT_URL. Never build/sign a PAY URL here.
export function authorizedGatewayUrl(value: unknown): string {
  if (typeof value !== 'string') throw new OrderError('UNAVAILABLE');
  const u = new URL(value);
  if (u.origin !== 'https://sandbox.vnpayment.vn' || u.pathname !== '/paymentv2/vpcpay.html' || u.username || u.password || u.hash || !u.search) throw new OrderError('UNAVAILABLE');
  return value;
}
export async function initiatePayment(orderId: string, key: string) {
  const v = await request('/payments/vnpay/attempts', 'POST', { orderId }, key) as { attemptId: string; orderId: string; provider: string; state: string; paymentUrl: string };
  if (!v || !uuid(v.attemptId) || v.orderId !== orderId || v.provider !== 'VNPAY_SANDBOX' || v.state !== 'AWAITING') throw new OrderError('UNAVAILABLE');
  return { attemptId: v.attemptId, paymentUrl: authorizedGatewayUrl(v.paymentUrl) };
}
export async function confirmZero(orderId: string, key: string) {
  const v = await request('/orders/' + orderId + '/confirm-zero', 'POST', {}, key) as {
    payment: { orderId: string; provider: string; method: string; amount: string; status: string };
    order: { id: string; status: string }; loyalty: { awardedPoints: number };
  };
  if (!v?.payment || v.payment.orderId !== orderId || v.payment.provider !== 'INTERNAL_ZERO' || v.payment.method !== 'ZERO_TOTAL'
    || v.payment.amount !== '0' || v.payment.status !== 'SUCCEEDED' || v.order?.id !== orderId || v.order.status !== 'PAID' || v.loyalty?.awardedPoints !== 0) throw new OrderError('UNAVAILABLE');
  return v;
}

export async function resumePayment(orderId: string) {
  const value = await request('/orders/' + orderId + '/payment-resume', 'POST') as { paymentUrl: unknown };
  return authorizedGatewayUrl(value.paymentUrl);
}

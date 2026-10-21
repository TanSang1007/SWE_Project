import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import { OrderError } from './orders';
import type { PaymentInput, PaymentResult } from '../../types/payment';
export function parsePayment(value: unknown): PaymentResult {
  if (!value || typeof value !== 'object') throw new OrderError('UNAVAILABLE');
  const { payment: p, order: o, loyalty: l } = value as PaymentResult;
  const uuid = (id: unknown) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
  if (!p || !o || !l || !uuid(p.id) || !uuid(p.orderId) || p.orderId !== o.id || typeof o.orderCode !== 'string'
    || typeof p.amount !== 'string' || !/^(0|[1-9]\d{0,11})$/.test(p.amount) || !['WALLET', 'CARD'].includes(p.method)
    || !Number.isInteger(l.awardedPoints) || l.awardedPoints < 0 || l.awardedPoints > 2147483647
    || !(p.status === 'SUCCEEDED' && o.status === 'PAID' && p.failureCode === undefined
      || p.status === 'FAILED' && o.status === 'PAYMENT_FAILED' && p.failureCode === 'MOCK_DECLINED' && l.awardedPoints === 0)) throw new OrderError('UNAVAILABLE');
  const hasLoyalty=['redeemedPoints','redemptionState','debtOffsetPoints','availablePointsAdded'].some(k=>Object.hasOwn(l,k));
  const integer=(n:unknown)=>typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=2147483647;
  if(hasLoyalty&&(!integer(l.redeemedPoints)||!integer(l.debtOffsetPoints)||!integer(l.availablePointsAdded)
    ||l.redemptionState!==(l.redeemedPoints===0?'NONE':p.status==='SUCCEEDED'?'SETTLED':'RELEASED')
    ||l.debtOffsetPoints!+l.availablePointsAdded! !== (p.status==='SUCCEEDED'?l.awardedPoints:l.redeemedPoints!)))throw new OrderError('UNAVAILABLE');
  const loyalty=hasLoyalty?{redeemedPoints:l.redeemedPoints,redemptionState:l.redemptionState,debtOffsetPoints:l.debtOffsetPoints,availablePointsAdded:l.availablePointsAdded}:{};
  return { payment: { id: p.id, orderId: p.orderId, status: p.status, amount: p.amount, method: p.method, ...(p.failureCode ? { failureCode: p.failureCode } : {}) },
    order: { id: o.id, orderCode: o.orderCode, status: o.status }, loyalty: { awardedPoints: l.awardedPoints, ...loyalty } };
}
export async function paymentRequest(body: PaymentInput, key: string): Promise<PaymentResult> {
  const token = getAccessToken(); if (!token) throw new OrderError('UNAUTHORIZED');
  try {
    const res = await fetch(`${getApiBaseUrl()}/payments`, { method: 'POST', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
    if (res.status === 401) { if (useAuthStore.getState().accessToken === token) useAuthStore.getState().clear(); throw new OrderError('UNAUTHORIZED'); }
    const value = await res.json();
    if(useAuthStore.getState().accessToken!==token)throw new OrderError('UNAUTHORIZED');
    if (!res.ok) throw new OrderError(value?.error?.code ?? 'UNAVAILABLE');
    const result = parsePayment(value);
    if (result.order.id !== body.orderId || result.payment.method !== body.method) throw new OrderError('UNAVAILABLE');
    return result;
  } catch (error) { if (error instanceof OrderError) throw error; throw new OrderError('UNAVAILABLE'); }
}

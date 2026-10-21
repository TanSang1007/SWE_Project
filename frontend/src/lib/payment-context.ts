import type { PaymentInput } from '../types/payment';
export interface PaymentContext { userId: string; key: string; payload: PaymentInput; }
const storageKey = 'brewlite-payment-context';
export function readPaymentContext(userId: string): PaymentContext | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as PaymentContext | null;
    if (!value || value.userId !== userId || typeof value.key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(value.key)
      || !value.payload || !/^[0-9a-f-]{36}$/i.test(value.payload.orderId) || !['WALLET', 'CARD'].includes(value.payload.method)) {
      clearPaymentContext(); return null;
    }
    return { userId: value.userId, key: value.key, payload: { orderId: value.payload.orderId, method: value.payload.method } };
  } catch { return null; }
}
export function writePaymentContext(context: PaymentContext) {
  sessionStorage.setItem(storageKey, JSON.stringify({ userId: context.userId, key: context.key,
    payload: { orderId: context.payload.orderId, method: context.payload.method } }));
}
export function clearPaymentContext() { try { sessionStorage.removeItem(storageKey); } catch { /* no mutation */ } }

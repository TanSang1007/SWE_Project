import type { OrderInput } from '../types/order';
import type { PaymentContext } from './payment-context';
export interface OrderContext { userId: string; key: string; payload: OrderInput; orderId?: string; previewSubtotal?: string; }
export function newOrderContext(userId: string, payload: OrderInput, previewSubtotal: string): OrderContext {
  return { userId, key: crypto.randomUUID(), payload, previewSubtotal };
}
export function recoveryOrderId(saved: OrderContext | null, payment: PaymentContext | null, requestedId?: string) {
  // Unknown create results keep their original key/payload; history must not replace them.
  return payment?.payload.orderId ?? saved?.orderId ?? (saved ? undefined : requestedId);
}
const storageKey = 'brewlite-order-context';
export function readOrderContext(userId: string): OrderContext | null {
  try { const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as OrderContext | null;
    if (!value || value.userId !== userId || typeof value.key !== 'string' || !value.payload || !Array.isArray(value.payload.items)
      || (value.orderId !== undefined && !/^[0-9a-f-]{36}$/i.test(value.orderId))) { sessionStorage.removeItem(storageKey); return null; }
    return { userId: value.userId, key: value.key, payload: value.payload, ...(value.orderId ? { orderId: value.orderId } : {}),
      ...(typeof value.previewSubtotal === 'string' && /^(0|[1-9]\d{0,11})$/.test(value.previewSubtotal) ? { previewSubtotal: value.previewSubtotal } : {}) };
  } catch { return null; }
}
export function writeOrderContext(context: OrderContext) {
  // A request must not start if its retry context cannot be persisted.
  const payload: OrderInput = { items: context.payload.items.map((i) => ({ productId: i.productId, size: i.size, qty: i.qty, toppingIds: [...i.toppingIds] })),
    ...(context.payload.promotionCode !== undefined ? { promotionCode: context.payload.promotionCode } : {}) };
  if (context.payload.redeemedPoints !== undefined) {
    if (!Number.isInteger(context.payload.redeemedPoints) || context.payload.redeemedPoints < 0 || context.payload.redeemedPoints > 2147483647) throw new Error('Invalid selected points');
    payload.redeemedPoints = context.payload.redeemedPoints;
  }
  sessionStorage.setItem(storageKey, JSON.stringify({ userId: context.userId, key: context.key, payload, orderId: context.orderId, previewSubtotal: context.previewSubtotal }));
}
export function clearOrderContext() { try { sessionStorage.removeItem(storageKey); } catch { /* no business mutation */ } }

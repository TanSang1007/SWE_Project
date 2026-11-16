import { uuid } from './api/gateway-payments';
import type { AttemptStatus } from './api/gateway-payments';
import type { Order } from '../types/order';
export interface GatewayContext { userId: string; orderId: string; key: string; attemptId?: string; }
const storageKey = 'brewlite-gateway-intent';
export function readGatewayContext(userId: string, orderId: string): GatewayContext | null {
  // Unreadable storage must block a new intent: a previous network outcome may be unknown.
  const raw = sessionStorage.getItem(storageKey); if (!raw) return null;
  const v = JSON.parse(raw) as GatewayContext;
  if (v.userId !== userId) { sessionStorage.removeItem(storageKey); return null; }
  if (!uuid(v.orderId) || typeof v.key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(v.key)
    || (v.attemptId !== undefined && !uuid(v.attemptId))) throw Error('Invalid payment recovery context');
  if (v.orderId !== orderId) return null;
  return { userId, orderId, key: v.key, ...(v.attemptId ? { attemptId: v.attemptId } : {}) };
}
export function writeGatewayContext(v: GatewayContext) {
  sessionStorage.setItem(storageKey, JSON.stringify({ userId: v.userId, orderId: v.orderId, key: v.key, ...(v.attemptId ? { attemptId: v.attemptId } : {}) }));
}
export function clearGatewayContext() { sessionStorage.removeItem(storageKey); }
export function gatewayPermission(order: Pick<Order, 'status' | 'total'>, status: AttemptStatus | null, saved: GatewayContext | null) {
  void saved;
  if (!['PENDING', 'PAYMENT_FAILED'].includes(order.status)) return false;
  if (order.total === '0') return order.status === 'PENDING' && !status;
  if (status?.effectiveState === 'SUCCEEDED') return false;
  return true;
}
export function nextGatewayIntent(userId: string, order: Pick<Order, 'id' | 'total'>, status: AttemptStatus | null, saved: GatewayContext | null): GatewayContext {
  if (!saved || saved.orderId !== order.id || saved.attemptId || status) {
    return { userId, orderId: order.id, key: crypto.randomUUID() };
  }
  return saved;
}

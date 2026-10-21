import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import { OrderError, parseOrder } from './orders';
import { orderStatusLabels, validOrderId } from '../order-display';
import type { OrderDetail, OrderHistoryItem } from '../../types/order';
const points = (value: unknown) => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647);
export function parseOrderHistory(value: unknown): OrderHistoryItem[] {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)) throw new OrderError('UNAVAILABLE');
  const seen = new Set<string>();
  return value.items.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new OrderError('UNAVAILABLE');
    const o = item as OrderHistoryItem;
    if (typeof o.id !== 'string' || !validOrderId(o.id) || seen.has(o.id.toLowerCase()) || typeof o.orderCode !== 'string'
      || !Object.hasOwn(orderStatusLabels, o.status) || o.currency !== 'VND' || typeof o.total !== 'string' || !/^(0|[1-9]\d{0,11})$/.test(o.total)
      || typeof o.createdAt !== 'string' || !Number.isFinite(Date.parse(o.createdAt)) || !points(o.earnedPoints)) throw new OrderError('UNAVAILABLE');
    const hasLoyalty = ['redeemedPoints','loyaltyDiscountAmount','redemptionState'].some(k=>Object.hasOwn(o,k));
    if (hasLoyalty && (!Number.isInteger(o.redeemedPoints)||o.redeemedPoints!<0||o.redeemedPoints!>2147483647
      ||typeof o.loyaltyDiscountAmount!=='string'||!/^(0|[1-9]\d{0,11})$/.test(o.loyaltyDiscountAmount)
      ||BigInt(o.loyaltyDiscountAmount)!==BigInt(o.redeemedPoints!)*100n||!['NONE','RESERVED','RELEASED','SETTLED','REFUNDED'].includes(o.redemptionState!)))throw new OrderError('UNAVAILABLE');
    const loyalty=hasLoyalty?{redeemedPoints:o.redeemedPoints,loyaltyDiscountAmount:o.loyaltyDiscountAmount,redemptionState:o.redemptionState}:{};
    seen.add(o.id.toLowerCase());
    return { id: o.id, orderCode: o.orderCode, status: o.status, total: o.total, currency: o.currency, createdAt: o.createdAt, earnedPoints: o.earnedPoints, ...loyalty };
  });
}
export function parseOrderDetail(value: unknown): OrderDetail {
  const order = parseOrder(value); const data = value as OrderDetail;
  if (!(data.paidAt === null || typeof data.paidAt === 'string' && Number.isFinite(Date.parse(data.paidAt)))
    || !points(data.earnedPoints) || ![null, 'SUCCEEDED', 'FAILED'].includes(data.paymentStatus)) throw new OrderError('UNAVAILABLE');
  return { ...order, paidAt: data.paidAt, earnedPoints: data.earnedPoints, paymentStatus: data.paymentStatus };
}
async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  const token = getAccessToken(); if (!token) throw new OrderError('UNAUTHORIZED');
  try {
    const timeout = AbortSignal.timeout(5000);
    const response = await fetch(`${getApiBaseUrl()}${path}`, { method: 'GET', cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}` }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (useAuthStore.getState().accessToken !== token) throw new OrderError('UNAUTHORIZED');
    if (response.status === 401) { useAuthStore.getState().clear(); throw new OrderError('UNAUTHORIZED'); }
    if (response.status === 404) throw new OrderError('ORDER_NOT_FOUND');
    if (!response.ok) throw new OrderError('UNAVAILABLE');
    const value: unknown = await response.json();
    if (useAuthStore.getState().accessToken !== token) throw new OrderError('UNAUTHORIZED');
    return value;
  } catch (error) { if (error instanceof OrderError) throw error; throw new OrderError('UNAVAILABLE'); }
}
export async function getOrderHistory(signal?: AbortSignal): Promise<OrderHistoryItem[]> { return parseOrderHistory(await read('/orders/me', signal)); }
export async function getOrderDetail(id: string, signal?: AbortSignal): Promise<OrderDetail> {
  if (!validOrderId(id)) throw new OrderError('ORDER_NOT_FOUND');
  const order = parseOrderDetail(await read('/orders/' + id, signal));
  if (order.id.toLowerCase() !== id.toLowerCase()) throw new OrderError('UNAVAILABLE');
  return order;
}

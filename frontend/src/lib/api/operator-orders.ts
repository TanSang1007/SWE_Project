import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import { orderStatusLabels, validOrderId } from '../order-display';
import { OrderError } from './orders';
import { parseOrderDetail, parseOrderHistory } from './order-history';
import type { Order } from '../../types/order';
import type { OperatorOrderDetail, OperatorOrderSummary, OrderRevision } from '../../types/operator-order';

function revision(value: unknown): OrderRevision {
  const row = value as OrderRevision;
  if (!row || !Number.isInteger(row.version) || row.version < 0 || row.version > 2147483647
    || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) throw new OrderError('UNAVAILABLE');
  return { version: row.version, updatedAt: row.updatedAt };
}
export function parseOperatorList(value: unknown): OperatorOrderSummary[] {
  const items = parseOrderHistory(value);
  const rows = (value as { items: unknown[] }).items;
  return items.map((item, index) => ({ ...item, ...revision(rows[index]) }));
}
export function parseOperatorDetail(value: unknown): OperatorOrderDetail {
  return { ...parseOrderDetail(value), ...revision(value) };
}
async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  const token = getAccessToken();
  const user = useAuthStore.getState().user;
  if (!token || !user) throw new OrderError('UNAUTHORIZED');
  const currentSession = () => {
    const state = useAuthStore.getState();
    return state.accessToken === token && state.user?.id === user.id && state.user.role === user.role;
  };
  try {
    const timeout = AbortSignal.timeout(5000);
    const res = await fetch(`${getApiBaseUrl()}${path}`, { method: 'GET', cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}` }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!currentSession()) throw new OrderError('UNAUTHORIZED');
    if (res.status === 401) { useAuthStore.getState().clear(); throw new OrderError('UNAUTHORIZED'); }
    if (res.status === 403) throw new OrderError('FORBIDDEN');
    if (res.status === 404) throw new OrderError('ORDER_NOT_FOUND');
    if (!res.ok) throw new OrderError('UNAVAILABLE');
    const value: unknown = await res.json();
    if (!currentSession()) throw new OrderError('UNAUTHORIZED');
    return value;
  } catch (error) { if (error instanceof OrderError) throw error; throw new OrderError('UNAVAILABLE'); }
}
export async function getOperatorOrders(status?: Order['status'], signal?: AbortSignal): Promise<OperatorOrderSummary[]> {
  if (status !== undefined && !Object.hasOwn(orderStatusLabels, status)) throw new OrderError('VALIDATION_ERROR');
  return parseOperatorList(await read('/operator/orders' + (status ? '?status=' + encodeURIComponent(status) : ''), signal));
}
export async function getOperatorOrder(id: string, signal?: AbortSignal): Promise<OperatorOrderDetail> {
  if (!validOrderId(id)) throw new OrderError('ORDER_NOT_FOUND');
  const order = parseOperatorDetail(await read('/operator/orders/' + id, signal));
  if (order.id.toLowerCase() !== id.toLowerCase()) throw new OrderError('UNAVAILABLE');
  return order;
}

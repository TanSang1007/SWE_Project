import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import { validOrderId } from '../order-display';
import { OrderError } from './orders';
import { parseOrderDetail } from './order-history';
import type { OperatorOrderDetail } from '../../types/operator-order';

export type WorkflowTarget = 'PREPARING' | 'READY' | 'COMPLETED' | 'CANCELLED';
export type WorkflowCommand = { id: string; sourceStatus: OperatorOrderDetail['status']; expectedVersion: number; targetStatus: WorkflowTarget };
export function canRetryOriginal(command: WorkflowCommand, current: OperatorOrderDetail): boolean {
  return current.id === command.id && current.status === command.sourceStatus && current.version === command.expectedVersion;
}
export async function sendWorkflow(command: WorkflowCommand, signal?: AbortSignal): Promise<void> {
  if (!validOrderId(command.id) || !Number.isInteger(command.expectedVersion) || command.expectedVersion < 0 || command.expectedVersion > 2147483647
    || !['PREPARING', 'READY', 'COMPLETED', 'CANCELLED'].includes(command.targetStatus)) throw new OrderError('VALIDATION_ERROR');
  const token = getAccessToken(); const user = useAuthStore.getState().user;
  if (!token || !user) throw new OrderError('UNAUTHORIZED');
  const currentSession = () => { const state = useAuthStore.getState(); return state.accessToken === token && state.user?.id === user.id && state.user.role === user.role; };
  const cancelling = command.targetStatus === 'CANCELLED';
  const path = cancelling ? `/admin/orders/${command.id}/paid-cancel` : `/operator/orders/${command.id}/transitions`;
  try {
    const timeout = AbortSignal.timeout(5000);
    const res = await fetch(`${getApiBaseUrl()}${path}`, { method: 'POST', cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: JSON.stringify({ expectedVersion: command.expectedVersion, ...(!cancelling ? { targetStatus: command.targetStatus } : {}) }) });
    if (!currentSession()) throw new OrderError('UNAUTHORIZED');
    if (res.status === 401) { useAuthStore.getState().clear(); throw new OrderError('UNAUTHORIZED'); }
    if (res.status === 403) throw new OrderError('FORBIDDEN');
    const value: unknown = await res.json();
    if (!currentSession()) throw new OrderError('UNAUTHORIZED');
    if (!res.ok) {
      const error = value as { error?: { code?: unknown } };
      const code = error?.error?.code;
      throw new OrderError(typeof code === 'string' && ['CONCURRENT_UPDATE', 'INVALID_ORDER_STATE', 'ORDER_NOT_FOUND', 'VALIDATION_ERROR', 'SERVICE_UNAVAILABLE'].includes(code) ? code : 'UNAVAILABLE');
    }
    const result = parseOrderDetail(value);
    if (result.id !== command.id || result.status !== command.targetStatus) throw new OrderError('UNAVAILABLE');
    // B16 result intentionally has no version. Caller must GET current A02 detail.
  } catch (error) { if (error instanceof OrderError) throw error; throw new OrderError('UNAVAILABLE'); }
}

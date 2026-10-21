import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
export class LoyaltyError extends Error {
  constructor(public readonly code: 'UNAUTHORIZED' | 'UNAVAILABLE') { super(code); }
}
export function parseLoyalty(value: unknown): number {
  if (!value || typeof value !== 'object' || !('loyaltyPoints' in value)
    || typeof value.loyaltyPoints !== 'number' || !Number.isInteger(value.loyaltyPoints)
    || value.loyaltyPoints < 0 || value.loyaltyPoints > 2147483647) throw new LoyaltyError('UNAVAILABLE');
  return value.loyaltyPoints;
}
export async function getLoyalty(signal?: AbortSignal): Promise<number> {
  const token = getAccessToken();
  if (!token) throw new LoyaltyError('UNAUTHORIZED');
  try {
    const timeout = AbortSignal.timeout(5000);
    const response = await fetch(`${getApiBaseUrl()}/loyalty`, { method: 'GET', cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}` }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (useAuthStore.getState().accessToken !== token) throw new LoyaltyError('UNAUTHORIZED');
    if (response.status === 401) {
      useAuthStore.getState().clear();
      throw new LoyaltyError('UNAUTHORIZED');
    }
    if (!response.ok) throw new LoyaltyError('UNAVAILABLE');
    const balance = parseLoyalty(await response.json());
    if (useAuthStore.getState().accessToken !== token) throw new LoyaltyError('UNAUTHORIZED');
    return balance;
  } catch (error) { if (error instanceof LoyaltyError) throw error; throw new LoyaltyError('UNAVAILABLE'); }
}

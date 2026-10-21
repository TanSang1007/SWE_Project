import type { UserRole } from '../types/auth';
import { safeReturnTo } from './auth-validation';

export function roleDestination(role: UserRole, value: string | null): string {
  const fallback = role === 'CUSTOMER' ? '/' : role === 'ADMIN' ? '/admin' : '/operator/orders';
  if (!value || safeReturnTo(value) !== value) return fallback;
  const path = value.split(/[?#]/)[0];
  if (role !== 'CUSTOMER' && !/^\/(admin|operator)(?:\/|$)/.test(path)) return fallback;
  if (/^\/admin(?:\/|$)/.test(path) && role !== 'ADMIN') return fallback;
  if (/^\/operator(?:\/|$)/.test(path) && role === 'CUSTOMER') return fallback;
  if (/^\/(cart|orders|loyalty)(?:\/|$)/.test(path) && role !== 'CUSTOMER') return fallback;
  return value;
}
export function shellAccess(role: UserRole | undefined, authenticated: boolean, allowed: readonly UserRole[]) {
  if (!authenticated || !role) return 'unauthorized' as const;
  return allowed.includes(role) ? 'allowed' as const : 'forbidden' as const;
}

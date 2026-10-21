'use client';
import { create } from 'zustand';
import type { AttemptStatus } from './api/gateway-payments';
import { verifiedCustomerCancellation } from './payment-result';

// Memory-only, bound to the authenticated session; never derived from Return query fields.
export const useCancellationNotice = create<{ notice: { token: string; status: AttemptStatus } | null }>(() => ({ notice: null }));
export function navigateAfterCancellation(status: AttemptStatus, token: string, replace: (path: string) => void) {
  if (!verifiedCustomerCancellation(status)) return false;
  useCancellationNotice.setState({ notice: { token, status } });
  replace('/');
  return true;
}

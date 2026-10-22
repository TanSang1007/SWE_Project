'use client';
import { create } from 'zustand';
import type { LoginResponse, PublicUser } from '../types/auth';
import { readOrderContext } from './order-context';
import { readPaymentContext } from './payment-context';
import { readInventoryContext } from './inventory-context';
interface AuthState {
  accessToken: string | null; user: PublicUser | null; expiresAt: number | null;
  signIn: (response: LoginResponse) => void; clear: () => void;
}
// Access JWT stays in memory; HttpOnly session restoration is managed by AuthSession.
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null, user: null, expiresAt: null,
  signIn: (response) => {
    // Keep uncertain same-owner transport recovery; discard another user's context.
    readOrderContext(response.user.id); readPaymentContext(response.user.id); readInventoryContext(response.user.id);
    set({ accessToken: response.accessToken, user: response.user, expiresAt: Date.now() + response.expiresIn * 1000 });
  },
  clear: () => set({ accessToken: null, user: null, expiresAt: null }),
}));
export function getAccessToken(): string | null {
  const state = useAuthStore.getState();
  if (!state.expiresAt || state.expiresAt <= Date.now()) { state.clear(); return null; }
  return state.accessToken;
}

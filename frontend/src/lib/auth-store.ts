'use client';
import { create } from 'zustand';
import type { LoginResponse, PublicUser } from '../types/auth';
import { readOrderContext } from './order-context';
import { readInventoryContext } from './inventory-context';

const TAB_SESSION_KEY = 'brewlite-tab-session';

export interface StoredTabSession {
  accessToken: string | null;
  user: PublicUser | null;
  expiresAt: number | null;
  sessionToken: string | null;
  loggedOut?: boolean;
}

export function readTabSession(): StoredTabSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(TAB_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTabSession;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeTabSession(data: StoredTabSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(TAB_SESSION_KEY, JSON.stringify(data));
  } catch {}
}

interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  expiresAt: number | null;
  sessionToken: string | null;
  signIn: (response: LoginResponse) => void;
  clear: (markLoggedOut?: boolean) => void;
}

// Each browser tab maintains its own isolated session in sessionStorage.
export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  expiresAt: null,
  sessionToken: null,
  signIn: (response) => {
    readOrderContext(response.user.id);
    readInventoryContext(response.user.id);
    const expiresAt = Date.now() + response.expiresIn * 1000;
    const sessionToken = response.sessionToken ?? get().sessionToken ?? readTabSession()?.sessionToken ?? null;
    writeTabSession({
      accessToken: response.accessToken,
      user: response.user,
      expiresAt,
      sessionToken,
      loggedOut: false,
    });
    set({ accessToken: response.accessToken, user: response.user, expiresAt, sessionToken });
  },
  clear: (markLoggedOut = true) => {
    writeTabSession({
      accessToken: null,
      user: null,
      expiresAt: null,
      sessionToken: null,
      loggedOut: markLoggedOut,
    });
    set({ accessToken: null, user: null, expiresAt: null, sessionToken: null });
  },
}));

export function getAccessToken(): string | null {
  const state = useAuthStore.getState();
  if (!state.expiresAt || state.expiresAt <= Date.now()) {
    state.clear(false);
    return null;
  }
  return state.accessToken;
}

'use client';
import { parseLogin, publicUser } from './api/auth';
import { readTabSession, useAuthStore } from './auth-store';
import type { PublicUser } from '../types/auth';

let pending: Promise<void> | null = null;
let generation = 0;

async function request(action: 'session' | 'logout', sessionToken?: string | null, isTabInit?: boolean) {
  const headers: Record<string, string> = { 'X-BrewLite-CSRF': '1' };
  if (sessionToken) headers['X-BrewLite-Session'] = sessionToken;
  else if (isTabInit && action === 'session') headers['X-BrewLite-Tab-Init'] = '1';
  return fetch('/api/auth/' + action, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
    signal: AbortSignal.timeout(10000),
  });
}

function verifyAccess(accessToken: string) {
  return fetch('/api/auth/me', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
}

function parseMe(value: unknown): PublicUser | null {
  try {
    return publicUser((value as { user?: unknown } | null)?.user);
  } catch {
    return null;
  }
}

export function restoreSession(): Promise<void> {
  if (pending) return pending;
  const version = generation;
  const stored = readTabSession();
  if (stored?.loggedOut) {
    useAuthStore.getState().clear(true);
    return Promise.resolve();
  }
  if (
    !useAuthStore.getState().accessToken &&
    stored?.accessToken &&
    stored.user &&
    stored.expiresAt &&
    stored.expiresAt > Date.now() + 60000
  ) {
    // F5 in the same tab keeps the session, but only after the server confirms
    // it is still live: a restarted BrewLite run rejects older sessions.
    const { accessToken, expiresAt, user: storedUser } = stored;
    const storedSessionToken = stored.sessionToken ?? null;
    pending = (async () => {
      const result = await verifyAccess(accessToken);
      if (version !== generation || useAuthStore.getState().accessToken) return;
      if (result.status === 401) {
        useAuthStore.getState().clear(false);
        return;
      }
      if (!result.ok) throw Error('Chưa kiểm tra được phiên đăng nhập. Vui lòng thử lại.');
      const user = parseMe(await result.json()) ?? storedUser;
      useAuthStore.setState({ accessToken, user, expiresAt, sessionToken: storedSessionToken });
    })().finally(() => {
      pending = null;
    });
    return pending;
  }
  const initialToken = useAuthStore.getState().accessToken;
  const sessionToken = useAuthStore.getState().sessionToken ?? stored?.sessionToken ?? null;
  const isTabInit = !sessionToken;
  pending = (async () => {
    const result = await request('session', sessionToken, isTabInit);
    if (version !== generation || useAuthStore.getState().accessToken !== initialToken) return;
    if (result.status === 401) {
      useAuthStore.getState().clear(false);
      return;
    }
    if (!result.ok) throw Error('Chưa kiểm tra được phiên đăng nhập. Vui lòng thử lại.');
    const response = parseLogin(await result.json());
    if (version === generation && useAuthStore.getState().accessToken === initialToken) {
      useAuthStore.getState().signIn(response);
    }
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function logoutSession() {
  generation++;
  const sessionToken = useAuthStore.getState().sessionToken ?? readTabSession()?.sessionToken ?? null;
  const response = await request('logout', sessionToken, false);
  if (!response.ok) throw Error('Chưa đăng xuất được. Vui lòng thử lại.');
  useAuthStore.getState().clear(true);
}

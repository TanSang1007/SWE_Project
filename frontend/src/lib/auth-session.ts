'use client';
import { parseLogin } from './api/auth';
import { useAuthStore } from './auth-store';

let pending: Promise<void> | null = null;
let generation = 0;
async function serialized<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('brewlite-session', work);
  return work();
}
async function request(action: 'session' | 'logout') {
  return fetch('/api/auth/' + action, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'X-BrewLite-CSRF': '1' }, signal: AbortSignal.timeout(10000) });
}
export function restoreSession(): Promise<void> {
  if (pending) return pending;
  const version = generation;
  const initialToken = useAuthStore.getState().accessToken;
  pending = serialized(async () => {
    const result = await request('session');
    if (version !== generation || useAuthStore.getState().accessToken !== initialToken) return;
    if (result.status === 401) { useAuthStore.getState().clear(); return; }
    if (!result.ok) throw Error('Chưa kiểm tra được phiên đăng nhập. Vui lòng thử lại.');
    const response = parseLogin(await result.json());
    if (version === generation && useAuthStore.getState().accessToken === initialToken) useAuthStore.getState().signIn(response);
  }).finally(() => { pending = null; });
  return pending;
}
export async function logoutSession() {
  generation++;
  await serialized(async () => {
    const response = await request('logout');
    if (!response.ok) throw Error('Chưa đăng xuất được. Vui lòng thử lại.');
    useAuthStore.getState().clear();
    if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('brewlite-auth'); channel.postMessage('logout'); channel.close(); }
  });
}

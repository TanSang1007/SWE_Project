'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { restoreSession } from '../lib/auth-session';
import { useAuthStore } from '../lib/auth-store';

export function AuthSession({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const expiresAt = useAuthStore(s => s.expiresAt), user = useAuthStore(s => s.user);
  const pathname = usePathname(), router = useRouter();
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function restore(attempt = 0) {
      try {
        await restoreSession();
        if (alive) { setError(''); setReady(true); }
      } catch {
        if (!alive) return;
        setError('Chưa kiểm tra được phiên đăng nhập.');
        // Startup/recompile can briefly interrupt the auth proxy. Retry only
        // transport/server failures; restoreSession handles 401 as signed out.
        if (attempt < 2) timer = setTimeout(() => void restore(attempt + 1), 1500 * (attempt + 1));
      }
    }
    void restore();
    return () => { alive = false; clearTimeout(timer); };
  }, [retry]);
  useEffect(() => {
    if (!error) return;
    const recover = () => { setError(''); setReady(false); setRetry(v => v + 1); };
    window.addEventListener('online', recover);
    window.addEventListener('focus', recover);
    return () => { window.removeEventListener('online', recover); window.removeEventListener('focus', recover); };
  }, [error]);
  useEffect(() => {
    if (!ready || !expiresAt) return;
    const refresh = () => { void restoreSession().catch(() => setError('Chưa gia hạn được phiên đăng nhập.')); };
    const timer = setTimeout(refresh, Math.max(1000, expiresAt - Date.now() - 60000));
    const focus = () => { if (expiresAt - Date.now() < 120000) refresh(); };
    window.addEventListener('focus', focus);
    return () => { clearTimeout(timer); window.removeEventListener('focus', focus); };
  }, [ready, expiresAt]);
  useEffect(() => {
    if (ready && !user && /^\/(cart|checkout|orders|loyalty|admin|operator)(\/|$)/.test(pathname)) router.replace('/login?returnTo=' + encodeURIComponent(pathname + window.location.search));
  }, [ready, user, pathname, router]);
  if (!ready) return <section className="state-panel" role="status"><p>{error || 'Đang khôi phục phiên đăng nhập…'}</p>{error && <button onClick={() => { setError(''); setRetry(v => v + 1); }}>Thử lại</button>}</section>;
  return <>{error && <p role="alert">{error} <button onClick={() => { setReady(false); setRetry(v => v + 1); }}>Thử lại</button></p>}{children}</>;
}

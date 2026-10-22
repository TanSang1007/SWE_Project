'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AuthError, authErrorMessage, login, register } from '../lib/api/auth';
import { safeReturnTo, validateCredentials } from '../lib/auth-validation';
import { useAuthStore } from '../lib/auth-store';
import { roleDestination } from '../lib/role-policy';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter(); const params = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const signIn = useAuthStore((state) => state.signIn);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return;
    const validation = validateCredentials({ email, password });
    if (validation) { setError(validation); return; }
    setPending(true); setError(null); controller.current = new AbortController();
    try {
      if (mode === 'register') {
        await register({ email, password }, controller.current.signal); setPassword('');
        router.replace(`/login?registered=1&returnTo=${encodeURIComponent(returnTo)}`);
      } else {
        const response = await login({ email, password }, controller.current.signal); setPassword(''); signIn(response);
        const channel = new BroadcastChannel('brewlite-auth'); channel.postMessage('login'); channel.close();
        router.replace(roleDestination(response.user.role, params.get('returnTo')));
      }
    } catch (error) {
      if (!controller.current.signal.aborted) setError(authErrorMessage(error instanceof AuthError ? error.code : 'UNAVAILABLE'));
    } finally { if (!controller.current.signal.aborted) setPending(false); }
  }
  const registering = mode === 'register';
  return <section className="auth-panel"><p className="eyebrow">BrewLite</p><h1>{registering ? 'Tạo tài khoản' : 'Chào bạn trở lại.'}</h1>
    <p className="section-note">{registering ? 'Đăng ký bằng email, sau đó đăng nhập để tiếp tục.' : 'Đăng nhập bằng email và mật khẩu của bạn.'}</p>
    {!registering && params.get('registered') === '1' && <p role="status" className="form-success">Đăng ký thành công. Bạn hãy đăng nhập.</p>}
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <label htmlFor="auth-email">Email</label><input id="auth-email" type="email" autoComplete="email" maxLength={254} required value={email}
        onChange={(event) => setEmail(event.target.value)} disabled={pending} aria-invalid={!!error} aria-describedby={error ? 'auth-error' : undefined} />
      <label htmlFor="auth-password">Mật khẩu</label><input id="auth-password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required value={password}
        onChange={(event) => setPassword(event.target.value)} disabled={pending} aria-invalid={!!error} aria-describedby={error ? 'password-help auth-error' : 'password-help'} />
      <p id="password-help" className="section-note">8–72 byte UTF-8. Dấu cách trong mật khẩu được giữ nguyên.</p>
      {error && <p id="auth-error" role="alert" className="form-error">{error}</p>}
      <button type="submit" className="button auth-submit" disabled={pending}>{pending ? 'Đang xử lý…' : registering ? 'Đăng ký' : 'Đăng nhập'}</button>
    </form>
    <p className="auth-switch">{registering ? 'Đã có tài khoản? ' : 'Chưa có tài khoản? '}
      <Link href={{ pathname: registering ? '/login' : '/register', query: { returnTo } }}>{registering ? 'Đăng nhập' : 'Đăng ký'}</Link></p>
  </section>;
}

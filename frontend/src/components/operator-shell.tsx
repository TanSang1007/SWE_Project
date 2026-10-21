'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { getAccessToken, useAuthStore } from '../lib/auth-store';
import { shellAccess } from '../lib/role-policy';
import type { UserRole } from '../types/auth';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function OperatorShellContent({ ready, role, authenticated, allowed, pathname, email, logout, children }: {
  ready: boolean; role?: UserRole; authenticated: boolean; allowed: readonly UserRole[]; pathname: string; email?: string; logout?: () => void; children: ReactNode;
}) {
  if (!ready) return <section className="state-panel" role="status"><h1>Đang kiểm tra đăng nhập…</h1></section>;
  const access = shellAccess(role, authenticated, allowed);
  if (access === 'unauthorized') return <section className="state-panel"><h1>Cần đăng nhập</h1>
    <p>Đăng nhập để truy cập khu vực vận hành. Nếu phiên đã hết hạn, hãy đăng nhập lại.</p><Link className="button" href={{ pathname: '/login', query: { returnTo: pathname } }}>Đăng nhập</Link></section>;
  if (access === 'forbidden') return <section className="state-panel"><h1>Không có quyền truy cập</h1>
    <p role="alert">Tài khoản của bạn không có quyền truy cập khu vực này.</p><Link className="button" href="/">Về thực đơn</Link></section>;
  const admin = role === 'ADMIN';
  const links = admin ? [['/admin', 'Tổng quan'], ['/admin/orders', 'Đơn hàng'], ['/admin/products', 'Sản phẩm'], ['/admin/toppings', 'Topping'], ['/admin/inventory', 'Tồn kho']]
    : [['/operator/orders', 'Đơn cần xử lý'], ['/operator/orders/completed', 'Đã hoàn thành']];
  return <section className={`operator-shell ${admin ? 'admin-shell' : 'staff-shell'}`}>
    <aside className="operations-sidebar"><Link className="operations-brand" href={admin ? '/admin' : '/operator/orders'}><span className="brand-mark" aria-hidden="true">b.</span>BrewLite</Link>
      <p className="eyebrow">{admin ? 'Quản trị cửa hàng' : 'Khu vực pha chế'}</p>
      <nav aria-label={admin ? 'Khu vực quản trị' : 'Khu vực pha chế'} className="operator-navigation">{links.map(([href, label]) => <Link key={href} href={href}
        aria-current={pathname === href || (href !== '/admin' && href !== '/operator/orders' && pathname.startsWith(href + '/')) ? 'page' : undefined}>{label}</Link>)}</nav>
    </aside><div className="operations-workspace"><header className="operations-topbar"><div><span className="role-badge">{admin ? 'Quản trị viên' : 'Nhân viên'}</span>
      <span className="operations-user">{email}</span></div><button type="button" className="nav-button" onClick={logout}>Đăng xuất</button></header>
      <div className="operations-content">{children}</div></div></section>;
}
export function OperatorShell({ allowed, children }: { allowed: readonly UserRole[]; children: ReactNode }) {
  const { user, accessToken, expiresAt, clear } = useAuthStore(); const pathname = usePathname(); const router = useRouter();
  const ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  useEffect(() => { getAccessToken(); }, [accessToken]);
  useEffect(() => { if (!expiresAt) return; const timer = setTimeout(clear, Math.max(0, expiresAt - Date.now())); return () => clearTimeout(timer); }, [expiresAt, clear]);
  return <OperatorShellContent ready={ready} role={user?.role} email={user?.email} logout={() => { clear(); router.replace('/login'); }} authenticated={!!accessToken} allowed={allowed} pathname={pathname}>
    {children}</OperatorShellContent>;
}

'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { useCartStore } from '../lib/cart-store';
export function AuthNav() {
  const pathname = usePathname();
  const { user, expiresAt, clear } = useAuthStore();
  const cart = useCartStore((s) => s.cart);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(clear, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, clear]);
  return <nav aria-label="Điều hướng chính" className="auth-nav"><Link href="/">Thực đơn</Link>
    {(!user || user.role === 'CUSTOMER') && <Link href="/cart">Giỏ ({user ? cart?.totalQuantity ?? 0 : 0})</Link>}
    {user ? <>{user.role === 'CUSTOMER' ? <><Link href="/orders">Đơn hàng</Link><Link href="/loyalty">Điểm tích lũy</Link></>
      : <><Link href="/operator/orders">Khu vực vận hành</Link>{user.role === 'ADMIN' && <Link href="/admin/products">Khu vực quản trị</Link>}</>}
      <span className="signed-in-label">Đã đăng nhập</span><button className="nav-button" type="button" onClick={clear}>Đăng xuất</button></>
      : <Link href={{ pathname: '/login', query: { returnTo: pathname } }}>Đăng nhập</Link>}
  </nav>;
}

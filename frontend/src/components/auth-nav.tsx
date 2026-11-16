'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { useCartStore } from '../lib/cart-store';
import { LogoutButton } from './logout-button';
export function AuthNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const cart = useCartStore((s) => s.cart);
  const customer = user?.role === 'CUSTOMER';
  // Load the signed-in customer's cart as soon as the header mounts, so the
  // badge is correct without opening /cart first.
  useEffect(() => {
    if (accessToken && customer) void useCartStore.getState().load().catch(() => {});
  }, [accessToken, customer]);
  return <nav aria-label="Điều hướng chính" className="auth-nav"><Link href="/">Thực đơn</Link>
    {(!user || customer) && <Link href="/cart">Giỏ ({user ? cart?.totalQuantity ?? 0 : 0})</Link>}
    {user ? <>{customer ? <><Link href="/orders">Đơn hàng</Link><Link href="/loyalty">Điểm tích lũy</Link></>
      : <><Link href="/operator/orders">Khu vực vận hành</Link>{user.role === 'ADMIN' && <Link href="/admin/products">Khu vực quản trị</Link>}</>}
      <span className="signed-in-label" title={`Đang đăng nhập: ${user.email}`}>{user.email}</span><LogoutButton email={user.email} /></>
      : <Link href={{ pathname: '/login', query: { returnTo: pathname } }}>Đăng nhập</Link>}
  </nav>;
}

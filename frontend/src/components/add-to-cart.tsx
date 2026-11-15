'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { useCartStore } from '../lib/cart-store';
import { cartErrorMessage, cartRequest } from '../lib/api/cart';
import type { ProductDetail } from '../types/catalog';
import type { CartInput } from '../types/cart';
import { useCartLock } from './pending-order';
import { CartOptions } from './cart-options';
export function AddToCart({ product }: { product: ProductDetail }) {
  const token = useAuthStore((s) => s.accessToken); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const cartLock = useCartLock();
  async function add(input: CartInput) {
    if (!token || inFlight.current || cartLock.locked) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const cart = await cartRequest('POST', '/cart/items', input);
      if (useAuthStore.getState().accessToken === token) { useCartStore.getState().setCart(cart); setMessage('Đã thêm vào giỏ.'); }
    } catch (error) {
      if (useAuthStore.getState().accessToken === token) {
        setMessage(cartErrorMessage(error));
        await useCartStore.getState().load().catch(() => {});
      }
    }
    finally { inFlight.current = false; setBusy(false); }
  }
<<<<<<< HEAD
  const label = cartLock.checking ? 'Đang kiểm tra đơn…' : cartLock.error ? 'Chưa kiểm tra được đơn' : cartLock.order ? 'Đang có đơn chưa hoàn tất' : 'Thêm vào giỏ';
  return <section aria-label="Thêm món vào giỏ"><CartOptions product={product} busy={busy} disabled={cartLock.locked} onConfirm={(input) => void add(input)} label={label} /><p role="status">{message}</p>
    {cartLock.checking && <p role="status">Đang kiểm tra đơn chưa hoàn tất. Vui lòng chờ tối đa 10 giây.</p>}
    {cartLock.error && <p role="alert">Chưa kiểm tra được đơn đang chờ. Kiểm tra kết nối rồi <button type="button" onClick={cartLock.retry}>Thử lại</button>.</p>}
    {cartLock.order && <p role="status">Giỏ đang khóa vì bạn có đơn chưa hoàn tất ({cartLock.order.orderCode}). <Link href={`/checkout?orderId=${cartLock.order.id}`}>Xem trạng thái đơn / thanh toán hoặc hủy khi được phép</Link></p>}
    <Link href="/cart">Xem giỏ</Link></section>;
=======
  return <section aria-label="Thêm món vào giỏ"><CartOptions product={product} busy={busy || (!!token && cartLock.locked)} onConfirm={(input) => void add(input)} label="Thêm vào giỏ" canSubmit={!!token} />{!token && <p><Link className="button" href={{ pathname: '/login', query: { returnTo: `/products/${product.id}` } }}>Đăng nhập để thêm giỏ</Link></p>}{message && <p role="status">{message}</p>}{!!token && cartLock.locked && <p role="status">Giỏ tạm khóa khi kiểm tra hoặc đang có đơn chưa hoàn tất. <Link href="/checkout">Mở đơn để thanh toán hoặc hủy</Link></p>}<Link href="/cart">Xem giỏ</Link></section>;
>>>>>>> origin/main
}

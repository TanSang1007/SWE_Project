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
import { notifyToast } from '../lib/notification-store';
export function AddToCart({ product }: { product: ProductDetail }) {
  const token = useAuthStore((s) => s.accessToken); const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const cartLock = useCartLock();
  async function add(input: CartInput) {
    if (!token || inFlight.current || cartLock.locked) return;
    inFlight.current = true; setBusy(true);
    try {
      const cart = await cartRequest('POST', '/cart/items', input);
      if (useAuthStore.getState().accessToken === token) {
        useCartStore.getState().setCart(cart);
        notifyToast('Đã thêm vào giỏ hàng thành công', 'success', `${product.name} (Size ${input.size} × ${input.qty})`);
      }
    } catch (error) {
      if (useAuthStore.getState().accessToken === token) {
        notifyToast(cartErrorMessage(error), 'error');
        await useCartStore.getState().load().catch(() => {});
      }
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section aria-label="Thêm món vào giỏ">
    <CartOptions product={product} busy={busy || (!!token && cartLock.locked)} onConfirm={(input) => void add(input)} label="Thêm vào giỏ" canSubmit={!!token} />
    <div className="checkout-action-group">
      {!token && <Link className="brew-btn brew-btn-primary" href={{ pathname: '/login', query: { returnTo: `/products/${product.id}` } }}>Đăng nhập để thêm giỏ</Link>}
      {!!token && cartLock.locked && <Link className="brew-btn brew-btn-secondary" href="/checkout">Mở đơn đang chờ</Link>}
      <Link className="brew-btn brew-btn-outline" href="/cart">Xem giỏ hàng</Link>
    </div>
  </section>;
}

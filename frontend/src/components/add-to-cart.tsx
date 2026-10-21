'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { useCartStore } from '../lib/cart-store';
import { cartErrorMessage, cartRequest } from '../lib/api/cart';
import type { ProductDetail } from '../types/catalog';
import type { CartInput } from '../types/cart';
import { CartOptions } from './cart-options';
export function AddToCart({ product }: { product: ProductDetail }) {
  const token = useAuthStore((s) => s.accessToken); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  if (!token) return <p><Link className="button" href={{ pathname: '/login', query: { returnTo: `/products/${product.id}` } }}>Đăng nhập để thêm giỏ</Link></p>;
  async function add(input: CartInput) {
    setBusy(true); setMessage('');
    try {
      const cart = await cartRequest('POST', '/cart/items', input);
      if (useAuthStore.getState().accessToken === token) { useCartStore.getState().setCart(cart); setMessage('Đã thêm vào giỏ.'); }
    } catch (error) { setMessage(cartErrorMessage(error)); await useCartStore.getState().load().catch(() => {}); }
    finally { setBusy(false); }
  }
  return <section aria-label="Thêm món vào giỏ"><CartOptions product={product} busy={busy} onConfirm={(input) => void add(input)} label="Thêm vào giỏ" /><p role="status">{message}</p><Link href="/cart">Xem giỏ</Link></section>;
}

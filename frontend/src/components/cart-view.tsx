'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { useCartStore } from '../lib/cart-store';
import { cartErrorMessage, cartRequest, editCartItem } from '../lib/api/cart';
import { getProductById } from '../lib/api/products';
import { formatVnd } from '../lib/money';
import type { Cart, CartInput, CartItem } from '../types/cart';
import type { ProductDetail } from '../types/catalog';
import { CartOptions } from './cart-options';
import { OrderCheckout } from './order-checkout';
export function CartView({ orderId }: { orderId?: string } = {}) {
  const token = useAuthStore((s) => s.accessToken);
  return <CartSession key={`${token ?? 'guest'}:${orderId ?? ''}`} orderId={orderId} />;
}
function CartSession({ orderId }: { orderId?: string }) {
  const token = useAuthStore((s) => s.accessToken); const cart = useCartStore((s) => s.cart);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [orderLocked, setOrderLocked] = useState(false);
  const [editing, setEditing] = useState<{ item: CartItem; product: ProductDetail } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  useEffect(() => { if (token) void useCartStore.getState().load().catch((e) => { if (useAuthStore.getState().accessToken === token) setError(cartErrorMessage(e)); }); }, [token]);
  async function mutate(method: string, id: string, qty?: number) {
    setBusy(true); setError('');
    try { const result = await cartRequest(method, `/cart/items/${id}`, qty === undefined ? undefined : { qty });
      if (useAuthStore.getState().accessToken === token) { useCartStore.getState().setCart(result); if (id === pendingDelete) setPendingDelete(null); }
    } catch (e) { setError(cartErrorMessage(e)); await useCartStore.getState().load().catch(() => {}); }
    finally { setBusy(false); }
  }
  async function beginEdit(item: CartItem) {
    setBusy(true); setError('');
    try { const product = await getProductById(item.productId); if (useAuthStore.getState().accessToken === token) setEditing({ item, product }); }
    catch (e) { setError(cartErrorMessage(e)); } finally { setBusy(false); }
  }
  async function edit(input: CartInput) {
    if (!editing) return; setBusy(true); setError('');
    try { const result = await editCartItem(editing.item, input);
      if (useAuthStore.getState().accessToken === token) { useCartStore.getState().setCart(result.cart); setPendingDelete(result.pendingDelete ?? null); setEditing(null); }
    } catch (e) { setError(cartErrorMessage(e)); await useCartStore.getState().load().catch(() => {}); }
    finally { setBusy(false); }
  }
  if (!token) return <><h1>Giỏ hàng</h1><p>Đăng nhập để tải giỏ đã lưu của bạn.</p><Link className="button" href={orderId ? '/login?returnTo=' + encodeURIComponent(`/cart?orderId=${orderId}`) : '/login?returnTo=/cart'}>Đăng nhập</Link></>;
  return <><h1>Giỏ hàng</h1>{error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => { setError(''); void useCartStore.getState().load().catch((e) => setError(cartErrorMessage(e))); }}>Tải lại giỏ</button>
    {!cart && !error && <p role="status">Đang tải giỏ…</p>}
    {pendingDelete && <aside role="alert"><p>Cấu hình mới đã được thêm. Dòng cũ chưa xóa được; cả hai vẫn còn trong giỏ.</p><button disabled={busy} onClick={() => void mutate('DELETE', pendingDelete)}>Thử xóa dòng cũ</button></aside>}
    {cart && <CartItems cart={cart} locked={busy || orderLocked || !!pendingDelete || !!editing} onQuantity={(item, qty) => void mutate('PATCH', item.id, qty)} onEdit={(item) => void beginEdit(item)} onRemove={(item) => void mutate('DELETE', item.id)} />}
    <OrderCheckout cart={cart} disabled={busy || !!pendingDelete || !!editing} onLock={setOrderLocked} resumeOrderId={orderId} />
    {editing && <section className="cart-editor"><h2>Chỉnh sửa {editing.item.productName}</h2>
      <CartOptions key={editing.item.id} product={editing.product} initial={{ productId: editing.item.productId, size: editing.item.size, toppingIds: editing.item.toppings.map((t) => t.id), qty: editing.item.qty }} busy={busy} showQuantity={false} onConfirm={(input) => void edit(input)} label="Lưu thay đổi" />
      <button disabled={busy} onClick={() => setEditing(null)}>Hủy chỉnh sửa</button></section>}
  </>;
}
export function CartItems({ cart, locked, onQuantity, onEdit, onRemove }: {
  cart: Cart; locked: boolean; onQuantity: (item: CartItem, qty: number) => void; onEdit: (item: CartItem) => void; onRemove: (item: CartItem) => void;
}) {
  return <>{cart.items.length === 0 && <p className="cart-empty">Giỏ đang trống. <Link href="/">Chọn đồ uống</Link></p>}
    <ul className="cart-list">{cart.items.map((item) => <li className="cart-item" key={item.id} data-item-id={item.id}>
      <h2>{item.productName}</h2><p>Size {item.size} · {item.toppings.map((t) => t.name).join(', ') || 'Không topping'}</p>
      {!item.available && <p role="alert">Món hoặc cấu hình hiện chưa thể đặt hàng. Món có thể hết hàng, ngừng bán hoặc có kích cỡ/topping không còn hợp lệ; hãy điều chỉnh hoặc xóa dòng này.</p>}<p>Đơn giá: {formatVnd(item.unitPrice)}</p>
      <div className="cart-actions"><button aria-label={`Giảm ${item.productName}`} disabled={locked || item.qty <= 1} onClick={() => onQuantity(item, item.qty - 1)}>−</button>
        <span className="cart-qty">{item.qty}</span><button aria-label={`Tăng ${item.productName}`} disabled={locked || item.qty >= 99} onClick={() => onQuantity(item, item.qty + 1)}>+</button>
        <button disabled={locked} onClick={() => onEdit(item)}>Chỉnh sửa</button><button disabled={locked} onClick={() => onRemove(item)}>Xóa</button></div>
      <p>Thành tiền: {formatVnd(item.lineTotal)}</p></li>)}</ul>
      <p className="cart-subtotal">Tạm tính: {formatVnd(cart.subtotal)}</p><p>Tổng số lượng: {cart.totalQuantity}</p>
  </>;
}

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
import { ProductImage } from './product-image';
import { PendingOrderBanner } from './pending-order';
export function CartView({ orderId }: { orderId?: string } = {}) {
  const token = useAuthStore((s) => s.accessToken);
  return <CartSession key={`${token ?? 'guest'}:${orderId ?? ''}`} orderId={orderId} />;
}
function CartSession({ orderId }: { orderId?: string }) {
  const token = useAuthStore((s) => s.accessToken); const cart = useCartStore((s) => s.cart);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ item: CartItem; product: ProductDetail } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (token) void useCartStore.getState().load()
      .catch((e) => { if (active) setError(cartErrorMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);
  async function reload() {
    setLoading(true); setError('');
    try { await useCartStore.getState().load(); }
    catch (e) { if (useAuthStore.getState().accessToken === token) setError(cartErrorMessage(e)); }
    finally { if (useAuthStore.getState().accessToken === token) setLoading(false); }
  }
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
  if (!token) return <section className="cart-page"><div className="state-panel"><p className="eyebrow">BrewLite / Giỏ hàng</p><h1>Giỏ hàng của bạn</h1><p>Đăng nhập để tải giỏ đã lưu của bạn.</p><Link className="button" href={orderId ? '/login?returnTo=' + encodeURIComponent(`/cart?orderId=${orderId}`) : '/login?returnTo=/cart'}>Đăng nhập</Link></div></section>;
  const locked = busy || loading || !!pendingDelete || !!editing;
  const checkoutReason = loading ? 'Đang cập nhật giỏ hàng…'
    : error ? 'Vui lòng tải lại giỏ để kiểm tra dữ liệu trước khi tiếp tục.'
    : pendingDelete ? 'Hãy xử lý dòng cũ trước khi tiếp tục.'
    : editing ? 'Hãy lưu hoặc hủy chỉnh sửa trước khi tiếp tục.'
    : busy ? 'Đang cập nhật giỏ hàng…'
    : !cart || cart.items.length === 0 ? 'Thêm đồ uống để tiếp tục.'
    : cart.items.some(item => !item.available) ? 'Hãy chỉnh sửa hoặc xóa món hiện không thể đặt.' : '';
  return <section className="cart-page">
    <header className="cart-heading"><div><p className="eyebrow">Một chút cà phê, một ngày dễ chịu</p><h1>Giỏ hàng của bạn</h1><p>Kiểm tra đồ uống trước khi đặt và nhận tại quầy.</p></div><Link className="cart-continue" href="/">← Tiếp tục chọn món</Link></header>
    {error && <p className="cart-notice cart-error" role="alert">{error}</p>}
    {pendingDelete && <aside className="cart-notice" role="alert"><p>Cấu hình mới đã được thêm. Dòng cũ chưa xóa được; cả hai vẫn còn trong giỏ.</p><button className="cart-secondary" disabled={busy || loading} onClick={() => void mutate('DELETE', pendingDelete)}>Thử xóa dòng cũ</button></aside>}
    <div className="cart-layout"><div className="cart-main">
      <div className="cart-section-heading"><h2>Đồ uống đã chọn {cart ? `(${cart.totalQuantity})` : ''}</h2><button className="cart-text-button" disabled={locked} onClick={() => void reload()}>{loading ? 'Đang tải…' : 'Tải lại giỏ'}</button></div>
      {loading && <p className="cart-notice" role="status">Đang tải giỏ…</p>}
      {busy && <p className="cart-progress" role="status">Đang cập nhật giỏ hàng…</p>}
      {cart && <CartItems cart={cart} locked={locked} onQuantity={(item, qty) => void mutate('PATCH', item.id, qty)} onEdit={(item) => void beginEdit(item)} onRemove={(item) => void mutate('DELETE', item.id)} />}
      {!cart && !loading && error && <div className="state-panel"><h2>Chưa tải được giỏ hàng</h2><p>Kiểm tra kết nối rồi chọn “Tải lại giỏ”.</p></div>}
      {editing && <section className="cart-editor" aria-labelledby="cart-editor-title"><p className="eyebrow">Tùy chỉnh đồ uống</p><h2 id="cart-editor-title">Chỉnh sửa {editing.item.productName}</h2><p>Số lượng giữ nguyên: {editing.item.qty} ly.</p>
        <CartOptions key={editing.item.id} product={editing.product} initial={{ productId: editing.item.productId, size: editing.item.size, toppingIds: editing.item.toppings.map((t) => t.id), qty: editing.item.qty }} busy={busy} showQuantity={false} onConfirm={(input) => void edit(input)} label="Lưu thay đổi" />
        <button className="cart-secondary" disabled={busy} onClick={() => setEditing(null)}>Hủy chỉnh sửa</button></section>}
      <PendingOrderBanner />
    </div><CartSummary cart={cart} reason={checkoutReason} /></div>
  </section>;
}
export function CartSummary({ cart, reason }: { cart: Cart | null; reason: string }) {
  return <aside className="cart-summary" aria-labelledby="cart-summary-title"><p className="eyebrow">Sẵn sàng cho ly tiếp theo?</p><h2 id="cart-summary-title">Tóm tắt giỏ hàng</h2>
    <dl><div><dt>Số lượng đồ uống</dt><dd>{cart?.totalQuantity ?? '—'}</dd></div><div className="cart-summary-total"><dt>Tạm tính</dt><dd>{cart ? formatVnd(cart.subtotal) : '—'}</dd></div></dl>
    <p className="cart-summary-note">Giá được cập nhật theo thực đơn hiện tại. Mã ưu đãi, điểm tích lũy và phương thức thanh toán được chọn ở bước tiếp theo.</p>
    {reason ? <><button className="button cart-checkout" disabled aria-describedby="cart-checkout-reason">Tiến hành thanh toán</button><p id="cart-checkout-reason" className="cart-checkout-reason" role="status">{reason}</p></> : <Link className="button cart-checkout" href="/checkout">Tiến hành thanh toán <span aria-hidden="true">→</span></Link>}
    <p className="cart-pickup">Nhận đồ uống tại quầy BrewLite</p>
  </aside>;
}

export function CartItems({ cart, locked, onQuantity, onEdit, onRemove }: {
  cart: Cart; locked: boolean; onQuantity: (item: CartItem, qty: number) => void; onEdit: (item: CartItem) => void; onRemove: (item: CartItem) => void;
}) {
  if (cart.items.length === 0) return <div className="state-panel cart-empty"><span className="cart-empty-icon" aria-hidden="true">☕</span><h2>Giỏ đang trống</h2><p>Một ly cà phê ngon đang chờ bạn trong thực đơn.</p><Link className="button" href="/">Chọn đồ uống</Link></div>;
  return <ul className="cart-list">{cart.items.map((item) => <li className={`cart-item${item.available ? '' : ' cart-item-unavailable'}`} key={item.id} data-item-id={item.id}>
    <div className="cart-item-image"><ProductImage src={item.imageUrl || '/images/drink-placeholder.svg'} name={item.productName} /></div>
    <div className="cart-item-content"><h2>{item.productName}</h2><p className="cart-item-options">Size {item.size} · {item.toppings.map((t) => t.name).join(', ') || 'Không topping'}</p>
      <p className="cart-unit-price">Đơn giá: {formatVnd(item.unitPrice)}</p>
      {!item.available && <p className="cart-item-warning" role="alert">Món hoặc tùy chọn hiện chưa thể đặt hàng. Vui lòng chỉnh sửa hoặc xóa món.</p>}
      <div className="cart-actions"><div className="cart-quantity" role="group" aria-label={`Số lượng ${item.productName}`}><button aria-label={`Giảm ${item.productName}`} disabled={locked || item.qty <= 1 || !item.available} onClick={() => onQuantity(item, item.qty - 1)}>−</button><span className="cart-qty">{item.qty}</span><button aria-label={`Tăng ${item.productName}`} disabled={locked || item.qty >= 99 || !item.available} onClick={() => onQuantity(item, item.qty + 1)}>+</button></div>
        <button className="cart-text-button" aria-label={`Chỉnh sửa ${item.productName}`} disabled={locked} onClick={() => onEdit(item)}>Chỉnh sửa</button><button className="cart-text-button cart-remove" aria-label={`Xóa ${item.productName}`} disabled={locked} onClick={() => onRemove(item)}>Xóa</button></div>
    </div><div className="cart-line-total"><span>Thành tiền</span><strong>{formatVnd(item.lineTotal)}</strong></div>
  </li>)}</ul>;
}

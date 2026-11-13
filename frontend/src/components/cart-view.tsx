'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { useCartStore } from '../lib/cart-store';
import { CartError, cartErrorMessage, cartRequest, editCartItem } from '../lib/api/cart';
import { getProductById } from '../lib/api/products';
import { formatVnd } from '../lib/money';
import { prepareCartCheckout } from '../lib/cart-checkout';
import { checkoutErrorMessage } from '../lib/checkout-policy';
import type { Cart, CartInput, CartItem } from '../types/cart';
import type { ProductDetail } from '../types/catalog';
import { CartOptions } from './cart-options';
import { CartRemoveConfirmation } from './cart-remove-confirmation';
import { ProductImage } from './product-image';
import { activeOrder, PendingOrderBanner, useCartLock } from './pending-order';
export function CartView({ orderId }: { orderId?: string } = {}) {
  const token = useAuthStore((s) => s.accessToken);
  return <CartSession key={`${token ?? 'guest'}:${orderId ?? ''}`} orderId={orderId} />;
}
function CartSession({ orderId }: { orderId?: string }) {
  const token = useAuthStore((s) => s.accessToken); const cart = useCartStore((s) => s.cart);
  const cartLock = useCartLock();
  const saving = useCartStore(s => s.saving), syncError = useCartStore(s => s.syncError);
  const action = useRef(false);
  useEffect(() => {
    if (cartLock.order) useCartStore.getState().cancelPending();
  }, [cartLock.order]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ item: CartItem; product: ProductDetail } | null>(null);
  const [removing, setRemoving] = useState<CartItem | null>(null);
  const removeTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!removing && removeTrigger.current) {
      removeTrigger.current.focus();
      removeTrigger.current = null;
    }
  }, [removing]);
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
    if (cartLock.locked) return;
    if (action.current) return;
    action.current = true; setBusy(true); setError('');
    try {
      await useCartStore.getState().flush();
      if (useAuthStore.getState().accessToken !== token) return;
      const result = await cartRequest(method, `/cart/items/${id}`, qty === undefined ? undefined : { qty });
      if (useAuthStore.getState().accessToken === token) { useCartStore.getState().setCart(result); if (method === 'DELETE') setRemoving(null); }
    } catch (e) { setError(cartErrorMessage(e)); await useCartStore.getState().load().catch(() => {}); }
    finally { action.current = false; setBusy(false); }
  }
  async function beginEdit(item: CartItem) {
    if (cartLock.locked) return;
    if (action.current) return;
    action.current = true; setBusy(true); setError('');
    try {
      await useCartStore.getState().flush();
      if (useAuthStore.getState().accessToken !== token) return;
      const product = await getProductById(item.productId); if (useAuthStore.getState().accessToken === token) setEditing({ item: useCartStore.getState().cart?.items.find(row => row.id === item.id) ?? item, product }); }
    catch (e) { setError(cartErrorMessage(e)); } finally { action.current = false; setBusy(false); }
  }
  async function edit(input: CartInput) {
    if (!editing || cartLock.locked || action.current) return; action.current = true; setBusy(true); setError('');
    try { await useCartStore.getState().flush();
      if (useAuthStore.getState().accessToken !== token) return;
      const result = await editCartItem(editing.item, input);
      if (useAuthStore.getState().accessToken === token) { useCartStore.getState().setCart(result.cart); setEditing(null); }
    } catch (e) { setError(cartErrorMessage(e)); await useCartStore.getState().load().catch(() => {}); }
    finally { action.current = false; setBusy(false); }
  }
  async function checkout() {
    if (cartLock.locked || action.current) return false;
    action.current = true; setBusy(true); setError('');
    try {
      await prepareCartCheckout(async () => !!await activeOrder());
      if (useAuthStore.getState().accessToken !== token) return false;
      return true;
    } catch (e) {
      if (useAuthStore.getState().accessToken === token) {
        setError(e instanceof CartError
          ? e.code === 'CART_CHANGED' ? 'Giá hoặc nội dung giỏ đã thay đổi. Hãy kiểm tra tạm tính mới và bấm thanh toán lại.'
            : e.code === 'EMPTY_CART' ? 'Giỏ đang trống.' : cartErrorMessage(e)
          : checkoutErrorMessage(e, 'create'));
      }
      return false;
    } finally { action.current = false; setBusy(false); }
  }
  if (!token) return <section className="cart-page"><div className="state-panel"><p className="eyebrow">BrewLite / Giỏ hàng</p><h1>Giỏ hàng của bạn</h1><p>Đăng nhập để tải giỏ đã lưu của bạn.</p><Link className="button" href={orderId ? '/login?returnTo=' + encodeURIComponent(`/cart?orderId=${orderId}`) : '/login?returnTo=/cart'}>Đăng nhập</Link></div></section>;
  const locked = cartLock.locked || !!syncError || busy || loading || !!editing || !!removing;
  const checkoutReason = cartLock.locked ? (cartLock.order ? 'Giỏ đang khóa theo đơn chưa hoàn tất. Hãy thanh toán hoặc hủy đơn cũ.' : 'Đang kiểm tra đơn chưa hoàn tất; tạm khóa giỏ.')
    : loading ? 'Đang cập nhật giỏ hàng…'
    : syncError ? 'Chưa lưu được thay đổi. Hãy tải lại giỏ để kiểm tra trước khi tiếp tục.'
    : !cart && error ? 'Vui lòng tải lại giỏ để kiểm tra dữ liệu trước khi tiếp tục.'
    : removing ? 'Hãy xác nhận xóa hoặc chọn giữ lại món.'
    : editing ? 'Hãy lưu hoặc hủy chỉnh sửa trước khi tiếp tục.'
    : busy ? 'Đang cập nhật giỏ hàng…'
    : !cart || cart.items.length === 0 ? 'Thêm đồ uống để tiếp tục.'
    : cart.items.some(item => !item.available) ? 'Hãy chỉnh sửa hoặc xóa món hiện không thể đặt.'
    : cart.items.some(item => item.stock !== undefined && (item.requestedQuantity ?? item.qty) > item.stock) ? 'Số lượng đã chọn vượt tồn kho. Hãy giảm số lượng trước khi thanh toán.' : '';
  return <section className="cart-page">
    <header className="cart-heading"><div><p className="eyebrow">Một chút cà phê, một ngày dễ chịu</p><h1>Giỏ hàng của bạn</h1><p>Kiểm tra đồ uống trước khi đặt và nhận tại quầy.</p></div><Link className="cart-continue" href="/">← Tiếp tục chọn món</Link></header>
    {!!syncError && <p className="cart-notice cart-error" role="alert">{cartErrorMessage(syncError)} Thay đổi chưa xác nhận đã được bỏ; hãy tải lại giỏ.</p>}
    {error && <p className="cart-notice cart-error" role="alert">{error}</p>}

    <div className="cart-layout"><div className="cart-main">
      <div className="cart-section-heading"><h2>Đồ uống đã chọn {cart ? `(${cart.totalQuantity})` : ''}</h2><button className="cart-text-button" disabled={busy || loading} onClick={() => void reload()}>{loading ? 'Đang tải…' : 'Tải lại giỏ'}</button></div>
      {loading && <p className="cart-notice" role="status">Đang tải giỏ…</p>}
      {saving && <p className="cart-progress" role="status">Đang lưu thay đổi… Tạm tính có thể được cập nhật theo giá hiện tại.</p>}
      {busy && <p className="cart-progress" role="status">Đang cập nhật giỏ hàng…</p>}
      {removing && <CartRemoveConfirmation item={removing} busy={busy} onCancel={() => setRemoving(null)} onConfirm={() => { if (!busy) void mutate('DELETE', removing.id); }} />}
      {cart && <CartItems cart={cart} locked={locked} onQuantity={(item, qty) => { if (!locked && !action.current) useCartStore.getState().changeQuantity(item.id, qty); }} onEdit={(item) => void beginEdit(item)} onRemove={(item) => { removeTrigger.current = document.activeElement as HTMLElement | null; setRemoving(item); }} />}
      {!cart && !loading && error && <div className="state-panel"><h2>Chưa tải được giỏ hàng</h2><p>Kiểm tra kết nối rồi chọn “Tải lại giỏ”.</p></div>}
      {editing && <section className="cart-editor" aria-labelledby="cart-editor-title"><p className="eyebrow">Tùy chỉnh đồ uống</p><h2 id="cart-editor-title">Chỉnh sửa {editing.item.productName}</h2><p>Số lượng giữ nguyên: {editing.item.qty} ly.</p>
        <CartOptions key={editing.item.id} product={editing.product} initial={{ productId: editing.item.productId, size: editing.item.size, toppingIds: editing.item.toppings.map((t) => t.id), qty: editing.item.qty }} busy={busy || cartLock.locked} showQuantity={false} onConfirm={(input) => void edit(input)} label="Lưu thay đổi" />
        <button className="cart-secondary" disabled={busy} onClick={() => setEditing(null)}>Hủy chỉnh sửa</button></section>}
      <PendingOrderBanner order={cartLock.order} error={cartLock.error} />
    </div><CartSummary cart={cart} reason={checkoutReason} onCheckout={checkout} /></div>
  </section>;
}
export function CartSummary({ cart, reason, onCheckout }: { cart: Cart | null; reason: string; onCheckout?: () => Promise<boolean> }) {
  return <aside className="cart-summary" aria-labelledby="cart-summary-title"><p className="eyebrow">Sẵn sàng cho ly tiếp theo?</p><h2 id="cart-summary-title">Tóm tắt giỏ hàng</h2>
    <dl><div><dt>Số lượng đồ uống</dt><dd>{cart?.totalQuantity ?? '—'}</dd></div><div className="cart-summary-total"><dt>Tạm tính</dt><dd>{cart ? formatVnd(cart.subtotal) : '—'}</dd></div></dl>
    <p className="cart-summary-note">Giá được cập nhật theo thực đơn hiện tại. Mã ưu đãi, điểm tích lũy và phương thức thanh toán được chọn ở bước tiếp theo.</p>
    {reason ? <><button className="button cart-checkout" disabled aria-describedby="cart-checkout-reason">Tiến hành thanh toán</button><p id="cart-checkout-reason" className="cart-checkout-reason" role="status">{reason}</p></> : onCheckout ? <CartCheckoutButton prepare={onCheckout} /> : <Link className="button cart-checkout" href="/checkout">Tiến hành thanh toán <span aria-hidden="true">→</span></Link>}
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
      {item.stock !== undefined && (item.requestedQuantity ?? item.qty) > item.stock && <p className="cart-item-warning" role="alert">Bạn đã chọn tổng cộng {item.requestedQuantity ?? item.qty} ly {item.productName} qua các size/topping, hiện còn {item.stock} ly. Hãy giảm số lượng hoặc xóa bớt món.</p>}
      <div className="cart-actions"><div className="cart-quantity" role="group" aria-label={`Số lượng ${item.productName}`}>
        <button
          aria-label={`Giảm ${item.productName}`}
          disabled={locked || (!item.available && item.qty > 1)}
          onClick={() => {
            if (item.qty === 1) {
              onRemove(item);
            } else {
              onQuantity(item, item.qty - 1);
            }
          }}
        >
          −
        </button>
        <span className="cart-qty">{item.qty}</span><button aria-label={`Tăng ${item.productName}`} disabled={locked || item.qty >= 99 || !item.available} onClick={() => onQuantity(item, item.qty + 1)}>+</button></div>
        <button className="cart-text-button" aria-label={`Chỉnh sửa ${item.productName}`} disabled={locked} onClick={() => onEdit(item)}>Chỉnh sửa</button><button className="cart-text-button cart-remove" aria-label={`Xóa ${item.productName}`} disabled={locked} onClick={() => onRemove(item)}>Xóa</button></div>
    </div><div className="cart-line-total"><span>Thành tiền</span><strong>{formatVnd(item.lineTotal)}</strong></div>
  </li>)}</ul>;
}

function CartCheckoutButton({ prepare }: { prepare: () => Promise<boolean> }) {
  const router = useRouter();
  return <button className="button cart-checkout" onClick={() => { void prepare().then(ready => { if (ready) router.push('/checkout'); }); }}>
    Tiến hành thanh toán <span aria-hidden="true">→</span>
  </button>;
}

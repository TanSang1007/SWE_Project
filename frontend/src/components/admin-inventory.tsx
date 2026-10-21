'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { adminProductRequest } from '../lib/api/admin-products';
import { adjustInventory, getInventory, InventoryError, inventoryMessage, inventoryPreview } from '../lib/api/admin-inventory';
import { clearInventoryContext, readInventoryContext, saveInventoryContext } from '../lib/inventory-context';
import type { InventoryContext, InventoryItem } from '../types/admin-inventory';
import type { AdminProduct } from '../types/admin-product';
import '../app/inventory.css';
export function InventoryForm({ item, busy, submit, cancel }: { item: InventoryItem; busy: boolean; submit: (delta: number) => void; cancel: () => void }) {
  const [direction, setDirection] = useState('increase'), [quantity, setQuantity] = useState(''), [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  const preview = inventoryPreview(item.stock, direction, quantity);
  function save(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    if (!preview || (direction === 'decrease' && !confirmed)) { setError('Nhập số lượng nguyên hợp lệ, không vượt giới hạn tồn; xác nhận khi giảm tồn.'); return; }
    setError(''); submit(preview.delta);
  }
  return <form className="product-form" onSubmit={save} aria-busy={busy} aria-labelledby="inventory-form-title" noValidate>
    <h3 id="inventory-form-title">Điều chỉnh {item.productName}</h3><p>Tồn kho đã đọc: {item.stock} · Phiên bản: {item.version}</p>
    <fieldset disabled={busy}><legend>Điều chỉnh tồn kho</legend>
      <label htmlFor="inventory-direction">Tăng hoặc giảm</label><select id="inventory-direction" value={direction} onChange={e => { setDirection(e.target.value); setConfirmed(false); }}><option value="increase">Nhập thêm hàng</option><option value="decrease">Giảm tồn kho</option></select>
      <label htmlFor="inventory-quantity">Số lượng</label><input id="inventory-quantity" inputMode="numeric" value={quantity} onChange={e => { setQuantity(e.target.value); setConfirmed(false); }} aria-describedby="inventory-preview inventory-validation" />
      <p id="inventory-preview" role="status">{preview ? `Tồn kho dự kiến: ${preview.stock}` : 'Nhập số lượng nguyên từ 1 đến 2147483647, kết quả không được âm hoặc vượt giới hạn.'}</p>
      {direction === 'decrease' && <label><input id="inventory-confirm" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Tôi xác nhận giảm số lượng tồn kho khả dụng.</label>}
    </fieldset><p id="inventory-validation" role={error ? 'alert' : undefined}>{error}</p>
    <div className="product-actions"><button className="button" data-inventory-submit disabled={busy} type="submit">{busy ? 'Đang xử lý…' : 'Xác nhận điều chỉnh'}</button><button type="button" disabled={busy} onClick={cancel}>Hủy</button></div>
  </form>;
}
export function InventoryList({ items, statuses, disabled, select }: { items: InventoryItem[]; statuses: Record<string, boolean>; disabled: boolean; select: (item: InventoryItem) => void }) {
  if (!items.length) return <p>Chưa có sản phẩm trong tồn kho.</p>;
  return <table className="product-management-table"><caption>Tồn kho khả dụng theo sản phẩm</caption><thead><tr><th scope="col">Sản phẩm</th><th scope="col">Tồn kho</th><th scope="col">Kinh doanh</th><th scope="col">Thao tác</th></tr></thead><tbody className="admin-product-list">{items.map(item => <tr className="admin-product-card" key={item.productId} data-inventory-id={item.productId}>
    <td data-label="Sản phẩm">{item.productName}<small className="inventory-identity">{item.productId}</small></td><td data-label="Tồn kho">{item.stock} · Phiên bản {item.version}</td>
    <td data-label="Kinh doanh">{statuses[item.productId] === undefined ? 'Chưa tải được trạng thái kinh doanh' : statuses[item.productId] ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}</td>
    <td data-label="Thao tác"><button disabled={disabled} onClick={() => select(item)}>Nhập / điều chỉnh tồn kho</button></td>
  </tr>)}</tbody></table>;
}
export function AdminInventory() {
  const { accessToken, user } = useAuthStore();
  if (!accessToken || user?.role !== 'ADMIN') return null;
  return <InventorySession key={`${accessToken}:${user.id}:${user.role}`} />;
}
function InventorySession() {
  const { accessToken: token, user } = useAuthStore();
  const [items, setItems] = useState<InventoryItem[] | null>(null), [statuses, setStatuses] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [selected, setSelected] = useState<InventoryItem | null>(null), [context, setContext] = useState<InventoryContext | null>(null), [review, setReview] = useState(false);
  const gate = useRef(false), alive = useRef(true), heading = useRef<HTMLHeadingElement>(null);
  const current = () => alive.current && useAuthStore.getState().accessToken === token && useAuthStore.getState().user?.id === user?.id;
  async function read(signal?: AbortSignal) {
    const rows = await getInventory(signal); if (!current()) return;
    setItems(rows);
    try { const products = await adminProductRequest('GET', undefined, undefined, signal) as AdminProduct[]; if (current()) setStatuses(Object.fromEntries(products.map(p => [p.id, p.isActive]))); }
    catch { if (current()) setStatuses({}); }
    return rows;
  }
  useEffect(() => {
    alive.current = true; gate.current = true; const abort = new AbortController(); const stored = user ? readInventoryContext(user.id) : null;
    void Promise.resolve().then(() => { if (current() && !abort.signal.aborted) setContext(stored); });
    void Promise.resolve().then(() => read(abort.signal)).then(rows => {
      if (current() && rows && !stored) { const id = new URLSearchParams(window.location.search).get('productId'); setSelected(rows.find(p => p.productId === id) ?? null); }
    }).catch(e => { if (current() && !abort.signal.aborted) { setItems(null); setError(inventoryMessage(e instanceof InventoryError ? e.code : 'UNAVAILABLE')); } })
      .finally(() => { if (current() && !abort.signal.aborted) { gate.current = false; setBusy(false); } });
    return () => { alive.current = false; abort.abort(); };
    // Session remounts on token, user or role changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function refresh() {
    if (gate.current) return; gate.current = true; setBusy(true); setError(''); setSelected(null);
    try { await read(); } catch (e) { if (current()) { setItems(null); setError(inventoryMessage(e instanceof InventoryError ? e.code : 'UNAVAILABLE')); } }
    finally { if (current()) { gate.current = false; setBusy(false); } }
  }
  async function send(request: InventoryContext) {
    if (gate.current) return; gate.current = true; setBusy(true); setError(''); setSuccess(''); setContext(request);
    try {
      const result = await adjustInventory(request); if (!current()) return;
      clearInventoryContext(); setContext(null); setSelected(null);
      setSuccess(`Máy chủ đã xác nhận điều chỉnh. Tồn kho tại lần điều chỉnh: ${result.stock}.`);
      try { await read(); if (current()) { setReview(false); setSuccess(`Máy chủ đã xác nhận điều chỉnh. Danh sách đã tải lại tồn kho hiện tại.`); heading.current?.focus(); } }
      catch { if (current()) { setItems(null); setError('Điều chỉnh đã được xác nhận, nhưng chưa tải lại tồn kho hiện tại. Chỉ tải lại danh sách.'); } }
    } catch (e) {
      if (!current()) return; const code = e instanceof InventoryError ? e.code : 'UNAVAILABLE'; setError(inventoryMessage(code));
      if (['CONCURRENT_UPDATE', 'INVALID_STOCK_ADJUSTMENT', 'VALIDATION_ERROR', 'PRODUCT_NOT_FOUND', 'MISSING_IDEMPOTENCY_KEY'].includes(code)) {
        clearInventoryContext(); setContext(null); setReview(true); setSelected(null); setItems(null);
      } else if (['UNAUTHORIZED', 'FORBIDDEN'].includes(code)) { setItems(null); setSelected(null); }
      // Unknown result / in progress / mismatch retain the original context.
    } finally { if (current()) { gate.current = false; setBusy(false); } }
  }
  function submit(delta: number) {
    if (!selected || !user || context || review || gate.current) return;
    const request = { userId: user.id, productId: selected.productId, key: crypto.randomUUID(), body: { delta, expectedVersion: selected.version } };
    if (!saveInventoryContext(request)) { setError('Không lưu được yêu cầu khôi phục. Hãy bật lưu trữ phiên trước khi điều chỉnh.'); return; }
    void send(request);
  }
  return <section className="admin-inventory" aria-busy={busy}><h2 ref={heading} tabIndex={-1}>Quản lý tồn kho</h2>
    <p>Tồn kho là số lượng khả dụng. Trạng thái kinh doanh được đọc riêng khi tải danh sách; sản phẩm cần kích cỡ đang cung cấp để được đặt hàng.</p>
    <button data-inventory-reload disabled={busy} onClick={() => void refresh()}>Tải lại tồn kho</button>
    {busy && <p role="status">Đang tải / xử lý tồn kho…</p>}{error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}
    {context && <aside role="alert"><p>Còn một yêu cầu cần xác nhận kết quả. Không tạo điều chỉnh khác.</p><button data-inventory-recover disabled={busy} onClick={() => void send(context)}>Khôi phục yêu cầu</button></aside>}
    {review && <aside><p>Tải lại tồn kho và kiểm tra trước khi xác nhận thao tác mới. Không tự gửi lại điều chỉnh.</p><button data-inventory-review disabled={busy || !items} onClick={() => { setReview(false); setError(''); }}>Đã kiểm tra, bắt đầu thao tác mới</button></aside>}
    {selected && !context && !review && <InventoryForm key={`${selected.productId}:${selected.version}`} item={selected} busy={busy} submit={submit} cancel={() => { setSelected(null); heading.current?.focus(); }} />}
    {items && <InventoryList items={items} statuses={statuses} disabled={busy || !!context || review} select={item => { if (!gate.current) { setSelected(item); setError(''); setSuccess(''); setTimeout(() => document.getElementById('inventory-quantity')?.focus(), 0); } }} />}
  </section>;
}

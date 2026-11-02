'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { adminProductRequest, ProductManagementError, productManagementMessage, validateProductForm } from '../lib/api/admin-products';
import { formatVnd } from '../lib/money';
import type { AdminProduct, ProductCreate, ProductUpdate } from '../types/admin-product';

export function ProductForm({ product, toppings, busy, onSave, onCancel }: {
  product?: AdminProduct; toppings: AdminProduct['toppings']; busy: boolean;
  onSave: (body: ProductCreate | ProductUpdate) => void; onCancel: () => void;
}) {
  const [validation, setValidation] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim(); const price = String(data.get('price') ?? ''); const imageUrl = String(data.get('imageUrl') ?? '');
    const sizes = product ? undefined : data.getAll('sizes').map(size => ({ size: String(size) as 'S' | 'M' | 'L', extraPrice: String(data.get(`extra-${size}`) ?? '') }));
    const message = validateProductForm(name, price, imageUrl, sizes); setValidation(message); if (message) return;
    onSave(product ? { expectedVersion: product.version, name, price, imageUrl, isActive: data.get('isActive') === 'on' }
      : { name, price, imageUrl, sizes: sizes!, toppingIds: data.getAll('toppingIds').map(String) });
  }
  return <form className="product-form" onSubmit={submit} noValidate aria-busy={busy} aria-labelledby="product-form-title">
    <h3 id="product-form-title" tabIndex={-1}>{product ? `Chỉnh sửa ${product.name}` : 'Tạo sản phẩm'}</h3>
    <p>{product ? 'Thay đổi chỉ áp dụng cho thông tin hiện tại. Đơn đã tạo giữ nguyên giá.' : 'Sản phẩm mới đang kinh doanh, tồn kho ban đầu bằng 0. Hãy chọn kích cỡ và phụ thu.'}</p>
    {product && <Link className="back-link" href={`/admin/products/${product.id}/options`} aria-disabled={busy} tabIndex={busy ? -1 : 0} onClick={event => { if (busy) event.preventDefault(); }}>Quản lý Size & Topping của sản phẩm</Link>}
    <fieldset disabled={busy}><legend>Thông tin sản phẩm</legend>
      <label htmlFor="product-name">Tên sản phẩm</label><input id="product-name" name="name" defaultValue={product?.name ?? ''} maxLength={120} required aria-describedby={validation ? 'product-form-validation' : undefined} />
      <label htmlFor="product-price">Giá cơ bản (VND)</label><input id="product-price" name="price" inputMode="numeric" defaultValue={product?.price ?? ''} required />
      <label htmlFor="product-image">Đường dẫn ảnh trong /images/</label><input id="product-image" name="imageUrl" defaultValue={product?.imageUrl ?? ''} maxLength={512} required />
      {product && <label className="product-option"><input name="isActive" type="checkbox" defaultChecked={product.isActive} />Đang kinh doanh</label>}
    </fieldset>
    {!product && <><fieldset disabled={busy}><legend>Kích cỡ bắt buộc (chọn 1–3)</legend>{(['S', 'M', 'L'] as const).map(size => <div className="product-size-input" key={size}>
      <label className="product-option"><input type="checkbox" name="sizes" value={size} />Size {size}</label>
      <label htmlFor={`extra-${size}`}>Phụ thu {size} (VND)</label><input id={`extra-${size}`} name={`extra-${size}`} inputMode="numeric" defaultValue="0" /></div>)}</fieldset>
      <fieldset disabled={busy}><legend>Topping (không bắt buộc)</legend>{toppings.length ? toppings.map(t => <label className="product-option" key={t.id}><input type="checkbox" name="toppingIds" value={t.id} />{t.name} · {formatVnd(t.price)}</label>) : <p>Không có topping trong danh mục hiện tại.</p>}</fieldset></>}
    {validation && <p role="alert" id="product-form-validation">{validation}</p>}
    <div className="product-actions"><button className="button" data-product-save disabled={busy} type="submit">{busy ? 'Đang xử lý…' : 'Lưu sản phẩm'}</button><button type="button" disabled={busy} onClick={onCancel}>Hủy</button></div>
  </form>;
}
export function ProductList({ items, busy, onEdit, onToggle, onDelete }: {
  items: AdminProduct[]; busy: boolean; onEdit: (p: AdminProduct) => void; onToggle: (p: AdminProduct) => void; onDelete: (p: AdminProduct) => void;
}) {
  if (!items.length) return <p>Chưa có sản phẩm.</p>;
  return <table className="product-management-table"><caption>Danh mục sản phẩm — tồn kho chỉ đọc</caption><thead><tr><th scope="col">Sản phẩm</th><th scope="col">Giá cơ bản</th><th scope="col">Tồn kho</th><th scope="col">Kinh doanh / Đặt hàng</th><th scope="col">Thao tác</th></tr></thead>
    <tbody className="admin-product-list">{items.map(p => <tr className="admin-product-card" key={p.id} data-product-id={p.id}>
      <td data-label="Sản phẩm"><h3>{p.name}</h3><p>Kích cỡ: {p.sizes.map(s => `${s.size} (+${formatVnd(s.extraPrice)})`).join(', ') || 'Chưa cấu hình'}</p><p>Topping: {p.toppings.map(t => t.name).join(', ') || 'Không topping'}</p></td>
      <td data-label="Giá cơ bản">{formatVnd(p.price)}</td><td data-label="Tồn kho">Tồn kho: {p.stock} · {p.stock > 0 ? 'Có tồn' : 'Hết tồn'}</td>
      <td data-label="Trạng thái"><span className="role-badge">{p.isActive ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}</span><p>{p.isActive && p.stock > 0 && p.sizes.length > 0 ? 'Kiểm tra tùy chọn đang cung cấp' : 'Chưa thể đặt hàng'}</p>
        {!p.sizes.length && <p role="status">Chưa có kích cỡ hợp lệ; hiện chưa thể đặt hàng.</p>}</td>
      <td data-label="Thao tác"><div className="product-actions"><Link className="button" data-product-options href={`/admin/products/${p.id}/options`}>Size & Topping</Link><button disabled={busy} onClick={() => onEdit(p)}>Xem / chỉnh sửa</button><button disabled={busy} onClick={() => onToggle(p)}>{p.isActive ? 'Ngừng bán' : 'Bật bán lại'}</button><button className="product-danger" disabled={busy} onClick={() => onDelete(p)}>Xóa sản phẩm</button></div></td>
    </tr>)}</tbody></table>;
}
export function AdminProducts() {
  const token = useAuthStore(s => s.accessToken); const user = useAuthStore(s => s.user);
  return <ProductSession key={`${token ?? 'guest'}:${user?.id ?? ''}:${user?.role ?? ''}`} />;
}
function ProductSession() {
  const [created, setCreated] = useState<AdminProduct | null>(null);
  const [items, setItems] = useState<AdminProduct[] | null>(null); const [busy, setBusy] = useState(true);
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [review, setReview] = useState(false);
  const [form, setForm] = useState<AdminProduct | 'create' | null>(null); const [deleting, setDeleting] = useState<AdminProduct | null>(null);
  const gate = useRef(false); const alive = useRef(true); const heading = useRef<HTMLHeadingElement>(null);
  const token = useAuthStore.getState().accessToken;
  const current = () => alive.current && useAuthStore.getState().accessToken === token;
  async function read(signal?: AbortSignal) { const rows = await adminProductRequest('GET', undefined, undefined, signal) as AdminProduct[]; if (current()) setItems(rows); }
  useEffect(() => {
    alive.current = true; const abort = new AbortController(); gate.current = true;
    void adminProductRequest('GET', undefined, undefined, abort.signal).then(rows => { if (!abort.signal.aborted && useAuthStore.getState().accessToken === token) setItems(rows as AdminProduct[]); })
      .catch(e => { if (!abort.signal.aborted) { setItems(null); setForm(null); setDeleting(null); setError(productManagementMessage(e instanceof ProductManagementError ? e.code : 'UNAVAILABLE')); } })
      .finally(() => { if (!abort.signal.aborted) { gate.current = false; setBusy(false); } });
    return () => { alive.current = false; abort.abort(); };
  }, [token]);
  async function refresh() {
    if (gate.current) return; gate.current = true; setBusy(true); setError('');
    try { await read(); } catch (e) { if (current()) { setItems(null); setForm(null); setDeleting(null); setError(productManagementMessage(e instanceof ProductManagementError ? e.code : 'UNAVAILABLE')); } }
    finally { if (current()) { gate.current = false; setBusy(false); } }
  }
  async function edit(p: AdminProduct) {
    if (gate.current || review) return; gate.current = true; setBusy(true); setSuccess(''); setError(''); setDeleting(null);
    try { const row = await adminProductRequest('GET', p.id) as AdminProduct; if (current()) { setForm(row); setTimeout(() => document.getElementById('product-name')?.focus(), 0); } }
    catch (e) { if (current()) { if (e instanceof ProductManagementError && ['FORBIDDEN', 'UNAUTHORIZED'].includes(e.code)) { setItems(null); setForm(null); setDeleting(null); } setError(productManagementMessage(e instanceof ProductManagementError ? e.code : 'UNAVAILABLE')); } }
    finally { if (current()) { gate.current = false; setBusy(false); } }
  }
  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', id: string | undefined, body: ProductCreate | ProductUpdate | { expectedVersion: number }) {
    if (gate.current || review) return; gate.current = true; setBusy(true); setSuccess(''); setError('');
    try {
      const result = await adminProductRequest(method, id, body); if (!current()) return;
      setCreated(method === 'POST' ? result as AdminProduct : null);
      setForm(null); setDeleting(null);
      try { await read(); if (current()) { setSuccess('Đã lưu thay đổi trên máy chủ và tải lại danh sách.'); heading.current?.focus(); } }
      catch { if (current()) { setItems(null); setReview(true); setError('Máy chủ đã xác nhận thao tác, nhưng chưa tải lại được dữ liệu. Chỉ tải lại danh sách; không gửi lại thao tác.'); } }
    } catch (e) {
      if (!current()) return; const code = e instanceof ProductManagementError ? e.code : 'UNAVAILABLE'; setError(productManagementMessage(code));
      if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') { setItems(null); setForm(null); setDeleting(null); }
      else { if (code === 'UNAVAILABLE' || code === 'CONCURRENT_UPDATE') setReview(true); try { await read(); } catch { if (current()) setItems(null); } }
    } finally { if (current()) { gate.current = false; setBusy(false); } }
  }
  const toppings = [...new Map((items ?? []).flatMap(p => p.toppings).map(t => [t.id, t])).values()];
  return <section className="admin-products" aria-busy={busy}><h2 ref={heading} tabIndex={-1}>Quản lý sản phẩm</h2>
    <p>Tồn kho chỉ được hiển thị ở đây. Ngừng bán giữ nguyên tồn kho, giỏ và lịch sử đơn.</p>
    <div className="product-actions"><button onClick={() => void refresh()} disabled={busy}>Tải lại danh sách</button><button className="button" data-product-create disabled={busy || review || !items} onClick={() => { setForm('create'); setDeleting(null); setSuccess(''); setTimeout(() => document.getElementById('product-name')?.focus(), 0); }}>Tạo sản phẩm mới</button></div>
    {busy && <p role="status">Đang tải / xử lý sản phẩm…</p>}{error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}
    {created && <aside role="status"><p>Đã tạo sản phẩm. Tồn kho hiện tại: 0.</p><Link className="button" data-product-inventory href={`/admin/products/inventory?productId=${created.id}`}>Nhập tồn kho</Link></aside>}
    {review && <aside role="alert"><p>Kiểm tra danh sách hiện tại trước khi xác nhận một thao tác mới. Không tự gửi lại yêu cầu vừa rồi.</p><button disabled={busy || !items} onClick={() => { setReview(false); setForm(null); setDeleting(null); setError(''); }}>Đã kiểm tra danh sách, bắt đầu thao tác mới</button></aside>}
    {form && <ProductForm key={form === 'create' ? 'create' : `${form.id}:${form.version}`} product={form === 'create' ? undefined : form} toppings={toppings} busy={busy || review}
      onCancel={() => { setForm(null); heading.current?.focus(); }} onSave={body => void mutate(form === 'create' ? 'POST' : 'PATCH', form === 'create' ? undefined : form.id, body)} />}
    {deleting && <fieldset className="product-delete" disabled={busy || review}><legend>Xác nhận xóa {deleting.name}</legend><p>Chỉ xóa được sản phẩm chưa được giỏ hoặc lịch sử đơn sử dụng. Nếu bị chặn, hãy chọn ngừng bán.</p>
      <div className="product-actions"><button data-product-delete-confirm onClick={() => void mutate('DELETE', deleting.id, { expectedVersion: deleting.version })}>Xác nhận xóa</button><button onClick={() => { setDeleting(null); heading.current?.focus(); }}>Giữ sản phẩm</button></div></fieldset>}
    {items && <ProductList items={items} busy={busy || review} onEdit={p => void edit(p)} onToggle={p => void mutate('PATCH', p.id, { expectedVersion: p.version, isActive: !p.isActive })} onDelete={p => { if (!gate.current) { setDeleting(p); setForm(null); setSuccess(''); setTimeout(() => document.querySelector<HTMLButtonElement>('[data-product-delete-confirm]')?.focus(), 0); } }} />}
  </section>;
}

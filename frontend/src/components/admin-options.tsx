'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { adminProductRequest, ProductManagementError } from '../lib/api/admin-products';
import { getAssociations, getSizes, getTopping, getToppings, OptionError, optionMessage, optionRequest, parseAssociations, parseSizes, validOptionMoney } from '../lib/api/admin-options';
import { formatVnd } from '../lib/money';
import type { AdminProduct } from '../types/admin-product';
import type { AdminSize, AdminTopping, SizeList } from '../types/admin-option';

// One small session-bound controller shared by the two management screens.
function useManagement<T>(load: (signal?: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null); const [busy, setBusy] = useState(true);
  const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const [review, setReview] = useState(false);
  const gate = useRef(false); const alive = useRef(true); const abort = useRef(new AbortController());
  const token = useAuthStore.getState().accessToken;
  const current = () => alive.current && useAuthStore.getState().accessToken === token;
  const failed = (e: unknown) => {
    const code = e instanceof OptionError || e instanceof ProductManagementError ? e.code : 'UNAVAILABLE'; setError(optionMessage(code));
    if (['UNAUTHORIZED', 'FORBIDDEN'].includes(code)) setData(null);
    return code;
  };
  useEffect(() => {
    alive.current = true; abort.current = new AbortController(); gate.current = true;
    const controller = abort.current;
    void load(controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(e => { if (!controller.signal.aborted) { setData(null); failed(e); } })
      .finally(() => { if (!controller.signal.aborted) { gate.current = false; setBusy(false); } });
    return () => { alive.current = false; controller.abort(); };
    // load is memoized per resource, token switches remount the screen.
  }, [load]);
  async function refresh() {
    if (gate.current) return; gate.current = true; setBusy(true); setError(''); setSuccess('');
    try { const value = await load(abort.current.signal); if (current()) setData(value); }
    catch (e) { if (current()) { setData(null); failed(e); } }
    finally { if (current()) { gate.current = false; setBusy(false); } }
  }
  async function mutate(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: object, successMessage = 'Cập nhật thành công.', apply?: (res: unknown, prev: T) => T) {
    if (gate.current || review) return false; gate.current = true; setBusy(true); setError(''); setSuccess('');
    try {
      const res = await optionRequest(method, path, body, abort.current.signal); if (!current()) return false;
      if (apply) {
        setData(prev => prev ? apply(res, prev) : prev);
        setSuccess(successMessage);
        return true;
      }
      try { const value = await load(abort.current.signal); if (!current()) return false; setData(value); setSuccess(successMessage); return true; }
      catch { if (current()) { setError('Đã lưu thay đổi nhưng chưa tải lại được danh sách.'); } }
    } catch (e) {
      if (!current()) return false; const code = failed(e);
      if (!['UNAUTHORIZED', 'FORBIDDEN'].includes(code) && !apply) {
        try { const value = await load(abort.current.signal); if (current()) setData(value); } catch { /* keep existing view */ }
      }
    } finally { if (current()) { gate.current = false; setBusy(false); } }
    return false;
  }
  return { data, busy, error, success, review, refresh, mutate, acknowledge: () => { setReview(false); setError(''); }, reportError: failed };
}
export function Feedback({ busy, error, success, review, canReview, refresh, acknowledge }: {
  busy: boolean; error: string; success: string; review: boolean; canReview: boolean; refresh: () => void; acknowledge: () => void;
}) {
  return <><button type="button" data-options-reload disabled={busy} onClick={refresh}>Làm mới</button>
    {busy && <p role="status">Đang xử lý…</p>}{error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}
    {review && <aside role="alert"><p>Dữ liệu đã thay đổi, vui lòng kiểm tra lại.</p><button data-options-review disabled={busy || !canReview} onClick={acknowledge}>Tiếp tục</button></aside>}</>;
}
export function ToppingForm({ topping, busy, save, cancel }: { topping?: AdminTopping; busy: boolean; save: (body: object) => void; cancel: () => void }) {
  const [error, setError] = useState('');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return; const form = new FormData(e.currentTarget); const name = String(form.get('name') ?? '').trim(); const price = String(form.get('price') ?? '');
    if (!name || name.length > 120 || !validOptionMoney(price)) { setError('Vui lòng nhập tên hợp lệ (tối đa 120 ký tự) và mức giá hợp lệ.'); return; }
    save({ name, price, ...(topping ? { expectedVersion: topping.version, isActive: form.get('isActive') === 'on' } : {}) });
  }
  return <form className="product-form topping-form" onSubmit={submit} aria-label={topping ? 'Chỉnh sửa topping' : 'Tạo topping'} noValidate>
    <h2>{topping ? `Chỉnh sửa ${topping.name}` : 'Tạo topping'}</h2>
    <fieldset disabled={busy}><legend>Thông tin topping</legend><label htmlFor="topping-name">Tên topping</label><input id="topping-name" name="name" maxLength={120} defaultValue={topping?.name ?? ''} required />
      <label htmlFor="topping-price">Giá (VND)</label><input id="topping-price" name="price" inputMode="numeric" defaultValue={topping?.price ?? ''} required />
      {topping && <label className="product-option"><input type="checkbox" name="isActive" defaultChecked={topping.isActive} />Đang cung cấp</label>}</fieldset>
    {error && <p role="alert">{error}</p>}<div className="product-actions"><button className="button" data-topping-save type="submit" disabled={busy}>Lưu topping</button><button type="button" disabled={busy} onClick={cancel}>Hủy</button></div>
  </form>;
}
export function SizeForm({ size, available, busy, save, cancel }: { size?: AdminSize; available: string[]; busy: boolean; save: (body: object) => void; cancel: () => void }) {
  const [error, setError] = useState('');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return; const f = new FormData(e.currentTarget); const extraPrice = String(f.get('extraPrice') ?? '');
    if (!validOptionMoney(extraPrice)) { setError('Vui lòng nhập mức phụ thu hợp lệ.'); return; }
    save({ extraPrice, ...(size ? { isActive: f.get('isActive') === 'on' } : { size: String(f.get('size')) }) });
  }
  return <form className="product-form size-form" onSubmit={submit} noValidate aria-label={size ? 'Chỉnh sửa kích cỡ' : 'Thêm kích cỡ'}><h2>{size ? `Chỉnh sửa size ${size.size}` : 'Thêm kích cỡ'}</h2>
    <fieldset disabled={busy}><legend>Kích cỡ của sản phẩm</legend>{!size && <><label htmlFor="option-size">Kích cỡ</label><select id="option-size" name="size">{available.map(s => <option key={s}>{s}</option>)}</select></>}
      <label htmlFor="size-extra">Phụ thu (VND)</label><input id="size-extra" name="extraPrice" inputMode="numeric" defaultValue={size?.extraPrice ?? '0'} required />
      {size && <label className="product-option"><input name="isActive" type="checkbox" defaultChecked={size.isActive} />Đang cung cấp</label>}</fieldset>
    {error && <p role="alert">{error}</p>}<div className="product-actions"><button className="button" data-size-save disabled={busy} type="submit">Lưu kích cỡ</button><button type="button" disabled={busy} onClick={cancel}>Hủy</button></div>
  </form>;
}
export function AdminToppings() {
  const { accessToken, user } = useAuthStore(); if (!accessToken || user?.role !== 'ADMIN') return null;
  return <ToppingSession key={`${accessToken}:${user.id}:${user.role}`} />;
}
function ToppingSession() {
  const load = useCallback((signal?: AbortSignal) => getToppings(signal), []); const m = useManagement(load);
  const [form, setForm] = useState<AdminTopping | 'create' | null>(null); const [deleting, setDeleting] = useState<AdminTopping | null>(null); const [reading, setReading] = useState(false); const inspectGate = useRef(false);
  const busy = m.busy || m.review || reading;
  async function edit(id: string) {
    if (busy || inspectGate.current) return; inspectGate.current = true; setReading(true);
    try { setForm(await getTopping(id)); setDeleting(null); setTimeout(() => document.getElementById('topping-name')?.focus(), 0); }
    catch (e) { setForm(null); m.reportError(e); } finally { setReading(false); inspectGate.current = false; }
  }
  return <section className="admin-products admin-toppings"><div className="operations-page-header"><p className="eyebrow">Danh mục tùy chọn</p><h1>Quản lý Topping</h1></div>
    <Feedback {...m} canReview={!!m.data} refresh={() => void m.refresh()} acknowledge={() => { m.acknowledge(); setForm(null); setDeleting(null); }} />
    <button className="button" data-topping-create disabled={busy || !m.data} onClick={() => { setForm('create'); setDeleting(null); setTimeout(() => document.getElementById('topping-name')?.focus(), 0); }}>Tạo topping</button>
    {m.data && form && <ToppingForm key={form === 'create' ? 'create' : `${form.id}:${form.version}`} topping={form === 'create' ? undefined : form} busy={busy} cancel={() => setForm(null)}
      save={body => { void m.mutate(form === 'create' ? 'POST' : 'PATCH', `/admin/toppings${form === 'create' ? '' : '/' + form.id}`, body, form === 'create' ? 'Tạo topping thành công.' : 'Cập nhật topping thành công.').then(ok => { if (ok) setForm(null); }); }} />}
    {m.data && deleting && <fieldset className="product-delete" disabled={busy}><legend>Xác nhận xóa {deleting.name}</legend><button data-topping-delete-confirm onClick={() => void m.mutate('DELETE', '/admin/toppings/' + deleting.id, { expectedVersion: deleting.version }, 'Đã xóa topping.').then(ok => { if (ok) setDeleting(null); })}>Xác nhận xóa topping</button><button onClick={() => setDeleting(null)}>Hủy</button></fieldset>}
    {m.data && (m.data.length ? <ul className="option-cards">{m.data.map(t => <li key={t.id} data-topping-id={t.id}><h2>{t.name}</h2><p>{formatVnd(t.price)} · {t.isActive ? 'Đang cung cấp' : 'Ngừng cung cấp'}</p>
      <div className="product-actions"><button disabled={busy} onClick={() => void edit(t.id)}>Chỉnh sửa</button><button disabled={busy} onClick={() => void m.mutate('PATCH', '/admin/toppings/' + t.id, { expectedVersion: t.version, isActive: !t.isActive }, 'Đã cập nhật trạng thái topping.')}>{t.isActive ? 'Ngừng cung cấp' : 'Cung cấp lại'}</button><button disabled={busy} onClick={() => { setDeleting(t); setForm(null); }}>Xóa</button></div></li>)}</ul> : <p role="status">Chưa có topping.</p>)}
  </section>;
}
type ProductOptions = { product: AdminProduct; sizes: SizeList; associated: AdminTopping[]; all: AdminTopping[] };
export function AdminProductOptions({ id }: { id: string }) {
  const { accessToken, user } = useAuthStore(); if (!accessToken || user?.role !== 'ADMIN') return null;
  return <ProductOptionSession key={`${accessToken}:${user.id}:${user.role}:${id}`} id={id} />;
}
function ProductOptionSession({ id }: { id: string }) {
  const load = useCallback(async (signal?: AbortSignal): Promise<ProductOptions> => {
    const [product, sizes, assoc, all] = await Promise.all([adminProductRequest('GET', id, undefined, signal) as Promise<AdminProduct>, getSizes(id, signal), getAssociations(id, signal), getToppings(signal)]);
    return { product, sizes, associated: assoc.items, all };
  }, [id]);
  const m = useManagement(load); const [form, setForm] = useState<{ size?: AdminSize; version: number } | null>(null);
  const [confirming, setConfirming] = useState<{ path: string; version: number; label: string; kind: 'size' | 'topping' } | null>(null); const [selected, setSelected] = useState('');
  const busy = m.busy || m.review; const data = m.data;
  const missing = ['S', 'M', 'L'].filter(s => !data?.sizes.items.some(size => size.size === s));
  const applySizes = (res: unknown, prev: ProductOptions): ProductOptions => {
    const nextSizes = parseSizes(res, id);
    return { ...prev, product: { ...prev.product, version: nextSizes.productVersion }, sizes: nextSizes };
  };
  const applyAssociations = (res: unknown, prev: ProductOptions): ProductOptions => {
    const nextAssoc = parseAssociations(res);
    return { ...prev, product: { ...prev.product, version: nextAssoc.productVersion }, sizes: { ...prev.sizes, productVersion: nextAssoc.productVersion }, associated: nextAssoc.items };
  };
  return <section className="admin-products product-options"><div className="operations-page-header"><p className="eyebrow">Cấu hình đồ uống</p><h1>Size & Topping</h1></div><Link href="/admin/products">← Danh sách sản phẩm</Link> · <Link href="/admin/toppings">Quản lý danh mục topping</Link>
    <Feedback {...m} canReview={!!data} refresh={() => void m.refresh()} acknowledge={() => { m.acknowledge(); setForm(null); setConfirming(null); setSelected(''); }} />
    {data && <><h2>{data.product.name} ({data.product.id})</h2><p>Giá cơ bản: {formatVnd(data.product.price)} · Tồn kho: {data.product.stock}</p>
      <p data-option-availability>{!data.product.isActive ? 'Ngừng kinh doanh' : data.product.stock <= 0 ? 'Hết hàng' : data.sizes.items.some(s => s.isActive) ? 'Đang mở bán' : 'Chưa có kích cỡ mở bán'}</p>
      <section aria-label="Kích cỡ"><h2>Kích cỡ</h2><button className="button" data-size-create disabled={busy || !missing.length} onClick={() => { setForm({ version: data.sizes.productVersion }); setConfirming(null); setTimeout(() => document.getElementById('size-extra')?.focus(), 0); }}>Thêm kích cỡ</button>
        {!data.sizes.items.length && <p role="status">Chưa cấu hình kích cỡ.</p>}
        <ul className="option-cards">{data.sizes.items.map(s => <li key={s.size} data-size={s.size}><h3>Size {s.size}</h3><p>{formatVnd(s.extraPrice)} · {s.isActive ? 'Đang cung cấp' : 'Ngừng cung cấp'}</p><div className="product-actions">
          <button disabled={busy} onClick={() => { setForm({ size: s, version: data.sizes.productVersion }); setConfirming(null); setTimeout(() => document.getElementById('size-extra')?.focus(), 0); }}>Chỉnh sửa size</button>
          <button disabled={busy} onClick={() => void m.mutate('PATCH', `/admin/products/${id}/sizes/${s.size}`, { expectedVersion: data.sizes.productVersion, isActive: !s.isActive }, 'Đã cập nhật kích cỡ.', applySizes)}>{s.isActive ? 'Ngừng cung cấp size' : 'Cung cấp lại size'}</button>
          <button disabled={busy} onClick={() => { setConfirming({ path: `/admin/products/${id}/sizes/${s.size}`, version: data.sizes.productVersion, label: `size ${s.size}`, kind: 'size' }); setForm(null); }}>Xóa size</button></div></li>)}</ul>
        {form && <SizeForm key={`${form.size?.size ?? 'create'}:${form.version}`} size={form.size} available={missing} busy={busy} cancel={() => setForm(null)} save={body => {
          void m.mutate(form.size ? 'PATCH' : 'POST', `/admin/products/${id}/sizes${form.size ? '/' + form.size.size : ''}`, { ...body, expectedVersion: form.version }, 'Đã lưu cấu hình kích cỡ.', applySizes).then(ok => { if (ok) setForm(null); });
        }} />}</section>
      <section aria-label="Topping của sản phẩm"><h2>Topping của sản phẩm</h2>
        <label htmlFor="association-topping">Chọn topping</label><select id="association-topping" value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}><option value="">Chọn topping</option>{data.all.filter(t => !data.associated.some(a => a.id === t.id)).map(t => <option key={t.id} value={t.id}>{t.name}{t.isActive ? '' : ' (ngừng cung cấp)'}</option>)}</select>
        <button className="button" data-association-add disabled={busy || !selected} onClick={() => void m.mutate('POST', `/admin/products/${id}/toppings`, { toppingId: selected, expectedVersion: data.sizes.productVersion }, 'Thêm topping thành công.', applyAssociations).then(ok => { if (ok) setSelected(''); })}>Thêm liên kết topping</button>
        {!data.associated.length && <p role="status">Sản phẩm chưa có topping đi kèm.</p>}
        <ul className="option-cards">{data.associated.map(t => <li key={t.id} data-associated-topping={t.id}><h3>{t.name}</h3><p>{formatVnd(t.price)} · {t.isActive ? 'Đang cung cấp' : 'Ngừng cung cấp'}</p><button disabled={busy} onClick={() => { setConfirming({ path: `/admin/products/${id}/toppings/${t.id}`, version: data.sizes.productVersion, label: `topping ${t.name}`, kind: 'topping' }); setForm(null); }}>Gỡ liên kết</button></li>)}</ul></section>
      {confirming && <fieldset className="product-delete" disabled={busy}><legend>Xác nhận xóa {confirming.label}</legend><button data-option-delete-confirm onClick={() => void m.mutate('DELETE', confirming.path, { expectedVersion: confirming.version }, confirming.kind === 'topping' ? 'Đã gỡ liên kết topping.' : 'Đã xóa kích cỡ.', confirming.kind === 'topping' ? applyAssociations : applySizes).then(ok => { if (ok) setConfirming(null); })}>Xác nhận xóa</button><button onClick={() => setConfirming(null)}>Hủy</button></fieldset>}
    </>}
  </section>;
}

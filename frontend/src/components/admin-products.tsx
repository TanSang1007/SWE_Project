'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { adminProductRequest, ProductManagementError, productManagementMessage, validateProductForm, validateProductRecipes } from '../lib/api/admin-products';
import { getIngredients, ingredientName } from '../lib/api/ingredients';
import { ProductRecipeFields, type RecipeDraftLine } from './product-recipe-fields';
import { formatVnd } from '../lib/money';
import type { AdminProduct, ProductCreate, ProductUpdate, RecipeIngredientOption } from '../types/admin-product';

export function ProductForm({ product, toppings, busy, onSave, onCancel }: {
  product?: AdminProduct; toppings: AdminProduct['toppings']; busy: boolean;
  onSave: (body: ProductCreate | ProductUpdate) => void; onCancel: () => void;
}) {
  const [validation, setValidation] = useState('');
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [recipes, setRecipes] = useState<Record<string, RecipeDraftLine[]>>({
    S: [{ key: 0, ingredientId: '', amount: '' }], M: [{ key: 1, ingredientId: '', amount: '' }], L: [{ key: 2, ingredientId: '', amount: '' }],
  });
  const nextLine = useRef(3);
  const [waterMl, setWaterMl] = useState<Record<string, string>>({ S: '0', M: '0', L: '0' });
  const [ingredients, setIngredients] = useState<RecipeIngredientOption[] | null>(null);
  const [ingredientError, setIngredientError] = useState('');
  const [ingredientLoad, setIngredientLoad] = useState(0);
  useEffect(() => {
    if (product) return;
    const abort = new AbortController();
    void getIngredients(abort.signal).then(({ items }) => {
      const options = items.filter(item => item.isListed === true && (item.unit === 'KG' || item.unit === 'L'))
        .map(item => ({ id: item.id, name: ingredientName(item), unit: item.unit === 'KG' ? 'g' as const : 'ml' as const }));
      if (!abort.signal.aborted) {
        setIngredients(options); setIngredientError(options.length ? '' : 'Chưa có nguyên liệu. Hãy khởi tạo danh mục tại trang kho.');
      }
    }).catch(() => { if (!abort.signal.aborted) setIngredientError('Chưa tải được nguyên liệu. Dữ liệu bạn nhập vẫn được giữ.'); });
    return () => abort.abort();
  }, [product, ingredientLoad]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim(); const price = String(data.get('price') ?? ''); const imageUrl = String(data.get('imageUrl') ?? '');
    const sizes: ProductCreate['sizes'] | undefined = product ? undefined : data.getAll('sizes').map(size => ({
      size: String(size) as 'S' | 'M' | 'L', extraPrice: String(data.get(`extra-${size}`) ?? ''),
      waterMl: String(data.get(`water-${size}`) || '0'),
      recipe: recipes[String(size)].map(line => ({ ingredientId: line.ingredientId, amount: line.amount,
        unit: ingredients?.find(item => item.id === line.ingredientId)?.unit ?? 'g' })),
    }));
    const message = validateProductForm(name, price, imageUrl, sizes) || (sizes ? validateProductRecipes(sizes, ingredients ?? []) : '');
    setValidation(message); if (message) return;
    onSave(product ? { expectedVersion: product.version, name, price, imageUrl, isActive: data.get('isActive') === 'on' }
      : { name, price, imageUrl, sizes: sizes!, toppingIds: data.getAll('toppingIds').map(String) });
  }
  return <form className="product-form" onSubmit={submit} noValidate aria-busy={busy} aria-labelledby="product-form-title">
    <h3 id="product-form-title" tabIndex={-1}>{product ? `Chỉnh sửa ${product.name} (${product.id})` : 'Tạo sản phẩm'}</h3>
    {product && <Link className="back-link" href={`/admin/products/${product.id}/options`} aria-disabled={busy} tabIndex={busy ? -1 : 0} onClick={event => { if (busy) event.preventDefault(); }}>Quản lý Size & Topping của sản phẩm</Link>}
    <fieldset disabled={busy}><legend>Thông tin sản phẩm</legend>
      <label htmlFor="product-name">Tên sản phẩm</label><input id="product-name" name="name" defaultValue={product?.name ?? ''} maxLength={120} required aria-describedby={validation ? 'product-form-validation' : undefined} />
      <label htmlFor="product-price">Giá cơ bản (VND)</label><input id="product-price" name="price" inputMode="numeric" defaultValue={product?.price ?? ''} required />
      <label htmlFor="product-image">Đường dẫn ảnh trong /images/</label><input id="product-image" name="imageUrl" defaultValue={product?.imageUrl ?? ''} maxLength={512} required />
      {product && <label className="product-option"><input name="isActive" type="checkbox" defaultChecked={product.isActive} />Đang kinh doanh</label>}
    </fieldset>
    {!product && <><fieldset disabled={busy}><legend>Kích cỡ bắt buộc (chọn 1–3)</legend>
      <p>Chọn size để nhập công thức pha cho từng kích cỡ.</p>
      {ingredientError ? <div role="alert"><p>{ingredientError}</p><button type="button" onClick={() => { setIngredientError(''); setIngredientLoad(value => value + 1); }}>Tải lại nguyên liệu</button></div>
        : ingredients === null && <p role="status">Đang tải nguyên liệu…</p>}
      {(['S', 'M', 'L'] as const).map(size => <div className="product-size-input" key={size}>
      <label className="product-option"><input type="checkbox" name="sizes" value={size} checked={selectedSizes.includes(size)}
        onChange={event => setSelectedSizes(current => event.target.checked ? [...current, size] : current.filter(value => value !== size))} />Size {size}</label>
      <label htmlFor={`extra-${size}`}>Phụ thu {size} (VND)</label><input id={`extra-${size}`} name={`extra-${size}`} inputMode="numeric" defaultValue="0" />
      {selectedSizes.includes(size) && <ProductRecipeFields size={size} lines={recipes[size]} ingredients={ingredients ?? []}
        waterMl={waterMl[size]} onWaterChange={value => setWaterMl(current => ({ ...current, [size]: value }))}
        onChange={(key, field, value) => setRecipes(current => ({ ...current, [size]: current[size].map(line => line.key === key ? { ...line, [field]: value } : line) }))}
        onAdd={() => { const key = nextLine.current++; setRecipes(current => ({ ...current, [size]: [...current[size], { key, ingredientId: '', amount: '' }] })); }}
        onRemove={key => setRecipes(current => ({ ...current, [size]: current[size].filter(line => line.key !== key) }))} />}
      </div>)}</fieldset>
      <fieldset disabled={busy}><legend>Topping (không bắt buộc)</legend>{toppings.length ? toppings.map(t => <label className="product-option" key={t.id}><input type="checkbox" name="toppingIds" value={t.id} />{t.name} · {formatVnd(t.price)}</label>) : <p>Không có topping trong danh mục hiện tại.</p>}</fieldset></>}
    {validation && <p role="alert" id="product-form-validation">{validation}</p>}
    <div className="product-actions"><button className="button" data-product-save disabled={busy || (!product && !ingredients?.length)} type="submit">{busy ? 'Đang xử lý…' : 'Lưu sản phẩm'}</button><button type="button" disabled={busy} onClick={onCancel}>Hủy</button></div>
  </form>;
}
export function ProductList({ items, busy, onEdit, onToggle, onDelete }: {
  items: AdminProduct[]; busy: boolean; onEdit: (p: AdminProduct) => void; onToggle: (p: AdminProduct) => void; onDelete: (p: AdminProduct) => void;
}) {
  if (!items.length) return <p>Chưa có sản phẩm.</p>;
  return <table className="product-management-table"><caption>Danh mục sản phẩm</caption><thead><tr><th scope="col">Sản phẩm</th><th scope="col">Giá cơ bản</th><th scope="col">Nguyên liệu</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead>
    <tbody className="admin-product-list">{items.map(p => <tr className="admin-product-card" key={p.id} data-product-id={p.id}>
      <td data-label="Sản phẩm"><h3>{p.name} <small>({p.id})</small></h3><p>Kích cỡ: {p.sizes.map(s => `${s.size} (+${formatVnd(s.extraPrice)})`).join(', ') || 'Chưa cấu hình'}</p><p>Topping: {p.toppings.map(t => t.name).join(', ') || 'Không topping'}</p></td>
      <td data-label="Giá cơ bản">{formatVnd(p.price)}</td><td data-label="Nguyên liệu">{p.recipeConfigured===false?'Chưa có công thức':p.available?'Còn món':'Tạm hết'}{p.availableSizes?.length? <p>Size còn: {p.availableSizes.join(', ')}</p>:null}</td>
      <td data-label="Trạng thái"><span className="role-badge">{p.isActive ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}</span>
        {!p.sizes.length && <p role="status">Chưa có kích cỡ mở bán</p>}</td>
      <td data-label="Thao tác"><div className="product-actions"><Link className="button" data-product-options href={`/admin/products/${p.id}/options`}>Size & Topping</Link><button disabled={busy} onClick={() => onEdit(p)}>Chỉnh sửa</button><button disabled={busy} onClick={() => onToggle(p)}>{p.isActive ? 'Ngừng bán' : 'Bật bán lại'}</button><button className="product-danger" disabled={busy} onClick={() => onDelete(p)}>Xóa</button></div></td>
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
  useEffect(() => {
    if (busy || form || deleting || review) return;
    const abort = new AbortController(); let reading = false;
    async function updateAvailability() {
      if (reading || gate.current || document.visibilityState !== 'visible') return;
      reading = true;
      try {
        const rows = await adminProductRequest('GET', undefined, undefined, abort.signal) as AdminProduct[];
        if (!abort.signal.aborted && !gate.current && useAuthStore.getState().accessToken === token) setItems(rows);
      } catch { /* retain the last view on a background connection failure */ }
      finally { reading = false; }
    }
    const timer = window.setInterval(() => void updateAvailability(), 20_000);
    window.addEventListener('focus', updateAvailability);
    return () => { abort.abort(); window.clearInterval(timer); window.removeEventListener('focus', updateAvailability); };
  }, [token, busy, form, deleting, review]);
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
      try { await read(); if (current()) { setSuccess('Đã lưu thay đổi thành công.'); heading.current?.focus(); } }
      catch { if (current()) { setError('Đã lưu thay đổi nhưng chưa tải lại được danh sách.'); } }
    } catch (e) {
      if (!current()) return; const code = e instanceof ProductManagementError ? e.code : 'UNAVAILABLE'; setError(productManagementMessage(code));
      if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') { setItems(null); setForm(null); setDeleting(null); }
      else { try { await read(); } catch { /* keep existing view */ } }
    } finally { if (current()) { gate.current = false; setBusy(false); } }
  }
  const toppings = [...new Map((items ?? []).flatMap(p => p.toppings).map(t => [t.id, t])).values()];
  return <section className="admin-products" aria-busy={busy}><h2 ref={heading} tabIndex={-1}>Quản lý sản phẩm</h2>
    <div className="product-actions"><button onClick={() => void refresh()} disabled={busy}>Làm mới</button><button className="button" data-product-create disabled={busy || review || !items} onClick={() => { setForm('create'); setDeleting(null); setSuccess(''); setTimeout(() => document.getElementById('product-name')?.focus(), 0); }}>Tạo sản phẩm mới</button></div>
    {busy && <p role="status">Đang tải sản phẩm…</p>}{error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}
    {created && <aside role="status"><p>Đã tạo sản phẩm {created.name} ({created.id}). Món được mở bán khi có công thức và đủ nguyên liệu cho kích cỡ tương ứng.</p></aside>}
    {review && <aside role="alert"><p>Dữ liệu đã thay đổi, vui lòng kiểm tra lại.</p><button disabled={busy || !items} onClick={() => { setReview(false); setForm(null); setDeleting(null); setError(''); }}>Tiếp tục</button></aside>}
    {form && <ProductForm key={form === 'create' ? 'create' : `${form.id}:${form.version}`} product={form === 'create' ? undefined : form} toppings={toppings} busy={busy || review}
      onCancel={() => { setForm(null); heading.current?.focus(); }} onSave={body => void mutate(form === 'create' ? 'POST' : 'PATCH', form === 'create' ? undefined : form.id, body)} />}
    {deleting && <fieldset className="product-delete" disabled={busy || review}><legend>Xác nhận xóa {deleting.name} ({deleting.id})</legend>
      <div className="product-actions"><button data-product-delete-confirm onClick={() => void mutate('DELETE', deleting.id, { expectedVersion: deleting.version })}>Xác nhận xóa</button><button onClick={() => { setDeleting(null); heading.current?.focus(); }}>Hủy</button></div></fieldset>}
    {items && <ProductList items={items} busy={busy || review} onEdit={p => void edit(p)} onToggle={p => void mutate('PATCH', p.id, { expectedVersion: p.version, isActive: !p.isActive })} onDelete={p => { if (!gate.current) { setDeleting(p); setForm(null); setSuccess(''); setTimeout(() => document.querySelector<HTMLButtonElement>('[data-product-delete-confirm]')?.focus(), 0); } }} />}
  </section>;
}

'use client';
import { useState } from 'react';
import type { ProductDetail } from '../types/catalog';
import type { CartInput } from '../types/cart';
import { formatVnd } from '../lib/money';
export function CartOptions({ product, initial, busy, onConfirm, label, showQuantity = true, canSubmit = true }: {
  product: ProductDetail; initial?: CartInput; busy: boolean; onConfirm: (input: CartInput) => void; label: string; showQuantity?: boolean; canSubmit?: boolean;
}) {
  const [size, setSize] = useState(initial?.size ?? product.sizes.find(s => s.available !== false)?.size ?? product.sizes[0]?.size ?? '');
  const [toppingIds, setToppings] = useState(initial?.toppingIds ?? []);
  const [qty, setQty] = useState(initial?.qty ?? 1);
  const retired = toppingIds.filter(id => !product.toppings.some(t => t.id === id));
  const selectedSize = product.sizes.find(s => s.size === size);
  const maxQuantity = Math.min(99, selectedSize?.maxQuantity ?? 99);
  const validOptions = !!selectedSize && selectedSize.available !== false && retired.length === 0
    && product.toppings.every(t => !toppingIds.includes(t.id) || !t.availableSizes || t.availableSizes.includes(size));
  const preview = BigInt(product.price) + BigInt(product.sizes.find((s) => s.size === size)?.extraPrice ?? '0')
    + product.toppings.filter((t) => toppingIds.includes(t.id)).reduce((sum, t) => sum + BigInt(t.price), 0n);
  const allowed = !busy && product.available && validOptions && Number.isInteger(qty) && qty >= 1 && qty <= maxQuantity;
  return <form className="cart-options" onSubmit={(event) => { event.preventDefault(); if (allowed) onConfirm({ productId: product.id, size, toppingIds, qty }); }}>
    <fieldset disabled={busy}><legend>Chọn kích cỡ</legend>{!product.sizes.length && <p>Chưa có kích cỡ cho món này.</p>}{product.sizes.map((s) => <label key={s.size}><input type="radio" name="cart-size" value={s.size} disabled={s.available === false} checked={size === s.size} onChange={() => setSize(s.size)} />Size {s.size} (+{formatVnd(s.extraPrice)}){s.available === false && ' — Hết nguyên liệu'}</label>)}</fieldset>
    <fieldset disabled={busy}><legend>Chọn topping</legend>{!product.toppings.length && <p>Món này chưa có topping đi kèm.</p>}{product.toppings.map((t) => <label key={t.id}><input type="checkbox" value={t.id} checked={toppingIds.includes(t.id)} disabled={!toppingIds.includes(t.id) && !!t.availableSizes && !t.availableSizes.includes(size)} onChange={(event) => setToppings(event.target.checked ? [...toppingIds, t.id] : toppingIds.filter((id) => id !== t.id))} />{t.name} (+{formatVnd(t.price)}){t.availableSizes && !t.availableSizes.includes(size) && ' — Hết nguyên liệu cho size này'}</label>)}
      {retired.map(id => <label key={id}><input type="checkbox" checked onChange={() => setToppings(toppingIds.filter(value => value !== id))} />Topping đã chọn không còn được cung cấp — bỏ chọn để điều chỉnh</label>)}</fieldset>
    {!validOptions && <p role="alert">Kích cỡ hoặc topping đã chọn không còn hợp lệ. Hãy chọn lại; cấu hình cũ vẫn được giữ trong giỏ.</p>}
    {showQuantity && <label>Số lượng <input aria-label="Số lượng" type="number" min={1} max={Math.max(1, maxQuantity)} required disabled={busy || maxQuantity === 0} value={qty} onChange={(event) => setQty(event.target.valueAsNumber)} /></label>}
    {qty > maxQuantity && <p role="alert">Không đủ nguyên liệu cho {qty} ly size {size}. Hãy giảm số lượng hoặc chọn size khác.</p>}
    <p className="option-price">{validOptions ? `Giá dự tính mỗi ly: ${formatVnd(preview.toString())}` : 'Chọn cấu hình hợp lệ để xem giá dự tính.'}</p>
    {canSubmit && <button className="button cart-confirm" disabled={!allowed}>{busy ? 'Đang xử lý…' : label}</button>}
  </form>;
}

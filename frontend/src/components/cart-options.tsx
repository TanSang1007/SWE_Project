'use client';
import { useState } from 'react';
import type { ProductDetail } from '../types/catalog';
import type { CartInput } from '../types/cart';
import { formatVnd } from '../lib/money';
<<<<<<< HEAD
export function CartOptions({ product, initial, busy, disabled = false, onConfirm, label, showQuantity = true }: {
  product: ProductDetail; initial?: CartInput; busy: boolean; disabled?: boolean; onConfirm: (input: CartInput) => void; label: string; showQuantity?: boolean;
=======
export function CartOptions({ product, initial, busy, onConfirm, label, showQuantity = true, canSubmit = true }: {
  product: ProductDetail; initial?: CartInput; busy: boolean; onConfirm: (input: CartInput) => void; label: string; showQuantity?: boolean; canSubmit?: boolean;
>>>>>>> origin/main
}) {
  const [size, setSize] = useState(initial?.size ?? product.sizes.find(size => size.available !== false)?.size ?? product.sizes[0]?.size ?? '');
  const [toppingIds, setToppings] = useState(initial?.toppingIds ?? []);
  const [qty, setQty] = useState(initial?.qty ?? 1);
  const retired = toppingIds.filter(id => !product.toppings.some(t => t.id === id));
  const selectedSize = product.sizes.find(s => s.size === size);
  const validOptions = !!selectedSize && selectedSize.available !== false && retired.length === 0 && product.toppings.filter(t => toppingIds.includes(t.id)).every(t => !t.availableSizes || t.availableSizes.includes(size));
  const maxQuantity = Math.min(99, selectedSize?.maxQuantity ?? 99);
  const preview = BigInt(product.price) + BigInt(product.sizes.find((s) => s.size === size)?.extraPrice ?? '0')
    + product.toppings.filter((t) => toppingIds.includes(t.id)).reduce((sum, t) => sum + BigInt(t.price), 0n);
<<<<<<< HEAD
  return <form className="cart-options" onSubmit={(event) => { event.preventDefault(); if (!busy && !disabled) onConfirm({ productId: product.id, size, toppingIds, qty }); }}>
    <fieldset disabled={busy || disabled}><legend>Chọn kích cỡ</legend>{product.sizes.map((s) => <label key={s.size}><input type="radio" name="cart-size" value={s.size} disabled={s.available === false} checked={size === s.size} onChange={() => setSize(s.size)} />Size {s.size} (+{formatVnd(s.extraPrice)}){s.available === false ? ' · Hết món' : s.stockStatus === 'LOW_STOCK' ? ' · Sắp hết món' : ''}</label>)}</fieldset>
    <fieldset disabled={busy || disabled}><legend>Chọn topping</legend>{product.toppings.map((t) => <label key={t.id}><input type="checkbox" value={t.id} disabled={!!t.availableSizes && !t.availableSizes.includes(size) && !toppingIds.includes(t.id)} checked={toppingIds.includes(t.id)} onChange={(event) => setToppings(event.target.checked ? [...toppingIds, t.id] : toppingIds.filter((id) => id !== t.id))} />{t.name} (+{formatVnd(t.price)}){t.availableSizes && !t.availableSizes.includes(size) ? ' · Không đủ cho size này' : ''}</label>)}
      {retired.map(id => <label key={id}><input type="checkbox" checked onChange={() => setToppings(toppingIds.filter(value => value !== id))} />Topping đã chọn không còn được cung cấp — bỏ chọn để điều chỉnh</label>)}</fieldset>
    {!validOptions && <p role="alert">Kích cỡ hoặc topping đã chọn không còn hợp lệ. Hãy chọn lại; cấu hình cũ vẫn được giữ trong giỏ.</p>}
    {showQuantity && <label>Số lượng <input aria-label="Số lượng" type="number" min={1} max={Math.max(1,maxQuantity)} required disabled={busy || disabled} value={qty} onChange={(event) => setQty(event.target.valueAsNumber)} /></label>}
    {selectedSize?.maxQuantity !== undefined && <p role="status">Nguyên liệu hiện đủ tối đa {selectedSize.maxQuantity} ly size {size}; số lượng được kiểm tra lại khi đặt hàng.</p>}
    <p>{validOptions ? `Giá dự tính mỗi ly: ${formatVnd(preview.toString())}` : 'Chọn cấu hình hợp lệ để xem giá dự tính.'}</p>
    <button className="button cart-confirm" disabled={busy || disabled || !product.available || !validOptions || !Number.isInteger(qty) || qty < 1 || qty > maxQuantity}>{busy ? 'Đang xử lý…' : label}</button>
=======
  return <form className="cart-options" onSubmit={(event) => { event.preventDefault(); onConfirm({ productId: product.id, size, toppingIds, qty }); }}>
    <fieldset disabled={busy}><legend>Chọn kích cỡ</legend>{!product.sizes.length && <p>Chưa có kích cỡ cho món này.</p>}{product.sizes.map((s) => <label key={s.size}><input type="radio" name="cart-size" value={s.size} checked={size === s.size} onChange={() => setSize(s.size)} />Size {s.size} (+{formatVnd(s.extraPrice)})</label>)}</fieldset>
    <fieldset disabled={busy}><legend>Chọn topping</legend>{!product.toppings.length && <p>Món này chưa có topping đi kèm.</p>}{product.toppings.map((t) => <label key={t.id}><input type="checkbox" value={t.id} checked={toppingIds.includes(t.id)} onChange={(event) => setToppings(event.target.checked ? [...toppingIds, t.id] : toppingIds.filter((id) => id !== t.id))} />{t.name} (+{formatVnd(t.price)})</label>)}
      {retired.map(id => <label key={id}><input type="checkbox" checked onChange={() => setToppings(toppingIds.filter(value => value !== id))} />Topping đã chọn không còn được cung cấp — bỏ chọn để điều chỉnh</label>)}</fieldset>
    {!validOptions && <p role="alert">Kích cỡ hoặc topping đã chọn không còn hợp lệ. Hãy chọn lại; cấu hình cũ vẫn được giữ trong giỏ.</p>}
    {showQuantity && <label>Số lượng <input aria-label="Số lượng" type="number" min={1} max={99} required disabled={busy} value={qty} onChange={(event) => setQty(event.target.valueAsNumber)} /></label>}
    <p className="option-price">{validOptions ? `Giá dự tính mỗi ly: ${formatVnd(preview.toString())}` : 'Chọn cấu hình hợp lệ để xem giá dự tính.'}</p>
    {canSubmit && <button className="button cart-confirm" disabled={busy || !product.available || !validOptions || !Number.isInteger(qty) || qty < 1 || qty > 99}>{busy ? 'Đang xử lý…' : label}</button>}
>>>>>>> origin/main
  </form>;
}

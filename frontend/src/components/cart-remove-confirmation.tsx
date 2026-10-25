'use client';
import { useEffect, useId, useRef } from 'react';
import type { CartItem } from '../types/cart';

export function CartRemoveConfirmation({ item, busy, onCancel, onConfirm }: {
  item: CartItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const headingId = useId();
  const keepButton = useRef<HTMLButtonElement>(null);

  useEffect(() => { keepButton.current?.focus(); }, []);

  return <section className="cart-remove-confirmation" aria-labelledby={headingId}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancel();
      }
    }}>
    <h2 id={headingId}>Xóa món khỏi giỏ hàng?</h2>
    <p>Bạn muốn xóa <strong>{item.productName}</strong> khỏi giỏ hàng?</p>
    <p className="cart-remove-detail">Size {item.size} · {item.toppings.map(topping => topping.name).join(', ') || 'Không topping'} · Số lượng: {item.qty}</p>
    <p>Toàn bộ số lượng của món này sẽ được xóa. Bạn có thể thêm lại từ thực đơn.</p>
    <div className="cart-actions">
      <button ref={keepButton} className="cart-secondary" disabled={busy} onClick={onCancel}>Giữ lại</button>
      <button className="button cart-confirm-remove" disabled={busy} onClick={onConfirm}>{busy ? 'Đang xóa…' : 'Xóa món'}</button>
    </div>
  </section>;
}

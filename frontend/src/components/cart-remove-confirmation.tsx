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
    <h2 id={headingId}>
      Bạn muốn xóa <strong>{item.productName}</strong> khỏi giỏ hàng?
    </h2>
    <div className="cart-actions">
      <button ref={keepButton} className="cart-secondary" disabled={busy} onClick={onCancel}>Giữ lại</button>
      <button className="button cart-confirm-remove" disabled={busy} onClick={onConfirm}>{busy ? 'Đang xóa…' : 'Xóa món'}</button>
    </div>
  </section>;
}

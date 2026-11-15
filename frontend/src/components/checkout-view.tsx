'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../lib/auth-store';
import { useCartStore } from '../lib/cart-store';
import type { Order } from '../types/order';
import { activeOrder, PendingOrder } from './pending-order';
import { OrderCheckout } from './order-checkout';
const ignoreLock = () => {};
export function CheckoutView({ orderId }: { orderId?: string }) {
  const token = useAuthStore(s => s.accessToken), cart = useCartStore(s => s.cart);
  const [state, setState] = useState<{ ready: boolean; order: Order | null; error: boolean }>({ ready: false, order: null, error: false });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    const load = () => {
      void (async () => {
        try {
          const order = await activeOrder(abort.signal);
          await useCartStore.getState().load();
          if (!abort.signal.aborted) setState({ ready: true, order, error: false });
        } catch { if (!abort.signal.aborted) setState({ ready: false, order: null, error: true }); }
      })();
    };
    load();
    window.addEventListener('brewlite-order-state-changed', load);
    return () => {
      abort.abort();
      window.removeEventListener('brewlite-order-state-changed', load);
    };
  }, [token, retry]);
  return <div className="checkout-page-container"><div className="checkout-page-header"><h1>Thanh toán</h1><Link className="brew-btn brew-btn-outline" href="/cart">← Quay lại giỏ hàng</Link></div>
    {!state.ready && <p role="status">{state.error ? 'Chưa kiểm tra được đơn hàng.' : 'Đang tải thông tin…'}</p>}
    {state.error && <button className="brew-btn brew-btn-secondary" onClick={() => setRetry(v => v + 1)}>Thử lại</button>}
    {state.ready && state.order && orderId && state.order.id !== orderId ? <PendingOrder order={state.order} modal />
      : state.ready && <OrderCheckout key={token + String(state.order?.id ?? orderId ?? 'new')} cart={cart} disabled={false} onLock={ignoreLock} resumeOrderId={state.order?.id ?? orderId} />}
  </div>;
}

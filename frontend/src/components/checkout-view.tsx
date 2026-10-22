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
    void (async () => {
      try {
        const order = await activeOrder(abort.signal);
        await useCartStore.getState().load();
        if (!abort.signal.aborted) setState({ ready: true, order, error: false });
      } catch { if (!abort.signal.aborted) setState({ ready: false, order: null, error: true }); }
    })();
    return () => abort.abort();
  }, [token, retry]);
  return <><h1>Thanh toán</h1><Link href="/cart">Quay lại giỏ hàng</Link>
    {!state.ready && <p role="status">{state.error ? 'Chưa kiểm tra được đơn đang chờ.' : 'Đang kiểm tra đơn đang chờ…'}</p>}
    {state.error && <button onClick={() => setRetry(v => v + 1)}>Thử lại</button>}
    {state.ready && state.order && state.order.id !== orderId ? <PendingOrder order={state.order} modal />
      : state.ready && <OrderCheckout key={token + String(orderId)} cart={cart} disabled={false} onLock={ignoreLock} resumeOrderId={state.order?.id ?? orderId} />}
  </>;
}

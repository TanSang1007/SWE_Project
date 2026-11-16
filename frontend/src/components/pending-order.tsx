'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getApiBaseUrl } from '../lib/env';
import { getAccessToken, useAuthStore } from '../lib/auth-store';
import { useCartStore } from '../lib/cart-store';
import { parseOrder } from '../lib/api/orders';
import type { Order } from '../types/order';
import { currentAttempt, type AttemptStatus } from '../lib/api/gateway-payments';

export async function activeOrder(signal?: AbortSignal): Promise<Order | null> {
  const token = getAccessToken(); if (!token) throw Error('Authentication required');
  const response = await fetch(getApiBaseUrl() + '/orders/active', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', credentials: 'omit', signal });
  if (!response.ok) throw Error('Active order unavailable');
  const data = await response.json();
  if (useAuthStore.getState().accessToken !== token) throw Error('Session changed');
  return data.order === null ? null : parseOrder(data.order);
}
export function PendingOrder({ order, modal = false }: { order: Order; modal?: boolean }) {
  const [attempt, setAttempt] = useState<AttemptStatus | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), router = useRouter();
  useEffect(() => {
    const abort = new AbortController();
    void currentAttempt(order.id, abort.signal).then(value => { if (!abort.signal.aborted) setAttempt(value); }).catch(() => {});
    return () => abort.abort();
  }, [order.id]);
  useEffect(() => { if (modal) dialog.current?.showModal(); }, [modal]);
  const content = <><h2>Đơn hàng {order.customerOrderCode}</h2>
    <div className="checkout-action-group"><Link className="brew-btn brew-btn-primary" href={`/checkout?orderId=${order.id}`}>{attempt?.canResume ? 'Tiếp tục thanh toán' : 'Xử lý đơn hàng'}</Link>
      <Link className="brew-btn brew-btn-outline" href={`/orders/${order.id}/confirmation`}>Xem chi tiết</Link>
      {modal && <Link className="brew-btn brew-btn-secondary" href="/cart">Quay lại giỏ hàng</Link>}</div></>;
  return modal ? <dialog ref={dialog} aria-label="Đơn hàng đang chờ thanh toán" onCancel={() => router.push('/cart')}>{content}</dialog>
    : <aside className="pending-order-banner">{content}</aside>;
}
export function useCartLock() {
  const hadActive = useRef(false);
  const token = useAuthStore(s => s.accessToken);
  const [state, setState] = useState<{ token: string | null; order: Order | null; error: boolean }>({ token: null, order: null, error: false });
  useEffect(() => {
    const abort = new AbortController();
    let revision = 0;
    const load = () => {
      const request = ++revision;
      if (token) void activeOrder(abort.signal).then(async order => {
        if (abort.signal.aborted || request !== revision) return;
        // Refresh the retained/cleared Cart before unlocking after payment/cancel.
        if (hadActive.current && !order) await useCartStore.getState().load();
        if (!abort.signal.aborted && request === revision) { hadActive.current = !!order; setState({ token, order, error: false }); }
      }).catch(() => { if (!abort.signal.aborted && request === revision) setState({ token, order: null, error: true }); });
    };
    load(); const timer = setInterval(load, 5000);
    window.addEventListener('focus', load);
    window.addEventListener('brewlite-unpaid-order', load);
    window.addEventListener('brewlite-order-state-changed', load);
    return () => {
      abort.abort();
      clearInterval(timer);
      window.removeEventListener('focus', load);
      window.removeEventListener('brewlite-unpaid-order', load);
      window.removeEventListener('brewlite-order-state-changed', load);
    };
  }, [token]);
  const ready = state.token === token;
  return { order: ready ? state.order : null, error: ready && state.error,
    locked: !!token && (!ready || state.error || !!state.order) };
}
export function PendingOrderBanner({ order, error }: { order: Order | null; error: boolean }) {
  return <>{order && <PendingOrder order={order} />}{error && <p role="status">Chưa kiểm tra được đơn đang chờ.</p>}</>;
}

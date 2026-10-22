'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getApiBaseUrl } from '../lib/env';
import { getAccessToken, useAuthStore } from '../lib/auth-store';
import { parseOrder } from '../lib/api/orders';
import type { Order } from '../types/order';
import { PaymentCountdown } from './payment-countdown';
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
  const content = <><h2>Đơn hàng đang chờ thanh toán</h2>
    <p>Bạn đang có đơn hàng chờ thanh toán. Vui lòng hoàn tất đơn hàng trước đó để tiếp tục thanh toán đơn mới.</p>
    <p>Mã đơn: <strong>{order.orderCode}</strong> · Trạng thái: {order.status}</p>
    <PaymentCountdown key={order.serverNow} expiresAt={order.expiresAt} serverNow={order.serverNow} verifying={order.status === 'PENDING' && !!attempt && ['UNKNOWN', 'AWAITING', 'REVIEW'].includes(attempt.effectiveState)} />
    <div className="cart-actions"><Link href={`/orders/${order.id}/confirmation`}>Xem đơn hàng</Link>
      <Link href={`/checkout?orderId=${order.id}`}>{attempt?.canResume ? 'Tiếp tục thanh toán đơn A' : 'Xem trạng thái / xử lý đơn cũ'}</Link>
      {modal && <Link href="/cart">Quay lại giỏ hàng</Link>}</div></>;
  return modal ? <dialog ref={dialog} aria-label="Đơn hàng đang chờ thanh toán" onCancel={() => router.push('/cart')}>{content}</dialog>
    : <aside className="pending-order-banner">{content}</aside>;
}
export function PendingOrderBanner() {
  const token = useAuthStore(s => s.accessToken), [order, setOrder] = useState<Order | null>(null), [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const load = () => { if (token) void activeOrder(abort.signal).then(value => { if (!abort.signal.aborted) { setOrder(value); setError(false); } }).catch(() => { if (!abort.signal.aborted) setError(true); }); };
    load(); const timer = setInterval(load, 15000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [token]);
  return <>{order && <PendingOrder order={order} />}{error && <p role="status">Chưa kiểm tra được đơn đang chờ. Giỏ vẫn có thể chỉnh sửa; checkout sẽ kiểm tra lại.</p>}</>;
}

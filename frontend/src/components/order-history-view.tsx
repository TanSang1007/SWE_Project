'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { getOrderDetail, getOrderHistory } from '../lib/api/order-history';
import { OrderError, orderRequest } from '../lib/api/orders';
import { formatVnd } from '../lib/money';
import { formatOrderTime, orderStatusLabels } from '../lib/order-display';
import { OrderSummary } from './order-summary';
import type { OrderDetail, OrderHistoryItem } from '../types/order';
import { currentAttempt, type AttemptStatus } from '../lib/api/gateway-payments';
import { clearOrderContext } from '../lib/order-context';
import { clearGatewayContext } from '../lib/gateway-context';
import { useCartStore } from '../lib/cart-store';
import { checkoutErrorMessage } from '../lib/checkout-policy';
import { notifyToast } from '../lib/notification-store';
export type OrderReadState = { status: 'loading' } | { status: 'error'; notFound: boolean }
  | { status: 'history'; items: OrderHistoryItem[] } | { status: 'detail'; order: OrderDetail; attempt?: AttemptStatus | null; attemptUnavailable?: boolean };
export function OrderHistoryView({ id }: { id?: string }) {
  const token = useAuthStore((s) => s.accessToken);
  const returnTo = id ? `/orders/${id}/confirmation` : '/orders';
  return <section className="order-history-page"><p className="eyebrow">BrewLite</p><h1>{id ? 'Chi tiết đơn hàng' : 'Lịch sử đơn hàng'}</h1>
    {token ? <OrderReadSession key={`${token}:${id ?? 'history'}`} id={id} /> : <div className="state-panel">
      <p>Đăng nhập để xem đơn hàng của bạn.</p><Link className="button" href={'/login?returnTo=' + encodeURIComponent(returnTo)}>Đăng nhập</Link></div>}
  </section>;
}
function OrderReadSession({ id }: { id?: string }) {
  const [state, setState] = useState<OrderReadState>({ status: 'loading' }); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = id ? getOrderDetail(id, controller.signal).then(async (order): Promise<OrderReadState> => {
      if (order.total === '0') return { status: 'detail', order };
      try { return { status: 'detail', order, attempt: await currentAttempt(order.id, controller.signal) }; }
      catch { return { status: 'detail', order, attemptUnavailable: true }; }
    })
      : getOrderHistory(controller.signal).then((items): OrderReadState => ({ status: 'history', items }));
    void load.then((result) => { if (!controller.signal.aborted) setState(result); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ status: 'error', notFound: error instanceof OrderError && error.code === 'ORDER_NOT_FOUND' }); });
    return () => controller.abort();
  }, [id, attempt]);
  function retry() { setState({ status: 'loading' }); setAttempt((value) => value + 1); }
  return <OrderReadContent state={state} retry={retry} />;
}
export function OrderReadContent({ state, retry }: { state: OrderReadState; retry: () => void }) {
  return <div className="order-read" aria-busy={state.status === 'loading'}>
    {state.status === 'loading' && <div className="state-panel" role="status" aria-live="polite"><div className="loading-mark" aria-hidden="true" /><p>Đang tải đơn hàng…</p></div>}
    {state.status === 'error' && <div className="state-panel" role="alert"><h2>{state.notFound ? 'Không tìm thấy đơn hàng' : 'Chưa tải được đơn hàng'}</h2>
      <p>{state.notFound ? 'Kiểm tra đường dẫn và tài khoản đăng nhập của bạn.' : 'Kết nối đang gián đoạn. Bạn thử lại sau một chút nhé.'}</p></div>}
    {state.status === 'history' && (state.items.length ? <OrderHistoryList items={state.items} /> : <div className="state-panel" role="status"><h2>Bạn chưa có đơn hàng</h2><p>Các đơn đã đặt sẽ xuất hiện ở đây.</p><Link className="button" href="/">Xem thực đơn</Link></div>)}
    {state.status === 'detail' && <OrderDetailContent order={state.order} attempt={state.attempt} attemptUnavailable={state.attemptUnavailable} onCancelled={retry} />}
    <div className="checkout-action-group" style={{ marginTop: 16 }}>
      <button type="button" className="brew-btn brew-btn-secondary" data-order-read-retry disabled={state.status === 'loading'} onClick={retry}>{state.status === 'error' ? 'Thử lại' : 'Tải lại đơn hàng'}</button>
    </div>
  </div>;
}
export function OrderHistoryList({ items }: { items: OrderHistoryItem[] }) {
  return <ol className="order-history-list" aria-label="Các đơn hàng của bạn">{items.map((order) => <li className="order-history-card" key={order.id} data-history-order={order.id}>
    <h2>Đơn {order.customerOrderCode}</h2><p className="order-status" data-order-status={order.status}>{orderStatusLabels[order.status]}</p>
    <p><time dateTime={order.createdAt}>{formatOrderTime(order.createdAt)}</time></p><p>Tổng đơn: <strong>{formatVnd(order.total)}</strong></p>
    <p>Điểm từ đơn này: {order.earnedPoints === null ? 'Chưa phát sinh' : order.earnedPoints.toLocaleString('vi-VN')}</p>
    <Link className="brew-btn brew-btn-primary" href={`/orders/${order.id}/confirmation`} aria-label={`Xem chi tiết đơn ${order.customerOrderCode}`}>Xem chi tiết</Link>
  </li>)}</ol>;
}
export function OrderDetailContent({ order, attempt, attemptUnavailable, onCancelled }: { order: OrderDetail; attempt?: AttemptStatus | null; attemptUnavailable?: boolean; onCancelled?: () => void }) {
  void attempt;
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  async function handleCancel() {
    if (cancelling || !['PENDING', 'PAYMENT_FAILED'].includes(order.status)) return;
    setCancelling(true); setCancelError('');
    try {
      await orderRequest('/orders/' + order.id + '/cancel', 'POST');
      clearOrderContext();
      clearGatewayContext();
      window.dispatchEvent(new CustomEvent('brewlite-order-state-changed'));
      void useCartStore.getState().load();
      notifyToast(`Đã hủy đơn hàng ${order.customerOrderCode}.`, 'info', 'Bạn có thể tạo đơn hàng mới ngay bây giờ.');
      onCancelled?.();
    } catch (e) {
      const msg = checkoutErrorMessage(e, 'cancel');
      setCancelError(msg);
      notifyToast(msg, 'error');
    } finally {
      setCancelling(false);
    }
  }
  return <article className="order-confirmation" data-confirmation-order={order.id}>
    <OrderSummary order={order} localizedStatus />
    <dl className="order-metadata"><div><dt>Thời điểm đặt</dt><dd><time dateTime={order.createdAt}>{formatOrderTime(order.createdAt)}</time></dd></div>
      {order.paidAt && <div><dt>Thời điểm thanh toán</dt><dd><time dateTime={order.paidAt}>{formatOrderTime(order.paidAt)}</time></dd></div>}
      <div><dt>Kết quả thanh toán</dt><dd>{order.paymentStatus === 'SUCCEEDED' ? 'Thành công' : order.paymentStatus === 'FAILED' ? 'Thất bại' : 'Chưa có kết quả'}</dd></div>
      <div><dt>Điểm từ đơn này</dt><dd>{order.earnedPoints === null ? 'Chưa phát sinh' : order.earnedPoints.toLocaleString('vi-VN') + ' điểm'}</dd></div></dl>
    {attemptUnavailable && <p role="alert">Chưa đọc được trạng thái giao dịch hiện tại.</p>}
    {cancelError && <p role="alert" className="checkout-error">{cancelError}</p>}
    <div className="checkout-action-group" style={{ marginTop: 18 }}>
      {['PENDING', 'PAYMENT_FAILED'].includes(order.status) && (
        <>
          <Link className="brew-btn brew-btn-primary" href={`/checkout?orderId=${order.id}`}>
            {order.status === 'PAYMENT_FAILED' ? 'Thanh toán lại' : 'Thanh toán đơn hàng'}
          </Link>
          <button type="button" className="brew-btn brew-btn-danger" disabled={cancelling} onClick={() => void handleCancel()}>
            {cancelling ? 'Đang hủy…' : 'Hủy đơn hàng'}
          </button>
        </>
      )}
      <Link className="brew-btn brew-btn-outline" href="/orders">Về lịch sử đơn hàng</Link>
      <Link className="brew-btn brew-btn-outline" href="/">Về thực đơn</Link>
    </div>
  </article>;
}

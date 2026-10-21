'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { getOperatorOrder, getOperatorOrders } from '../lib/api/operator-orders';
import { OrderError } from '../lib/api/orders';
import { formatOrderTime, orderStatusLabels } from '../lib/order-display';
import { formatVnd } from '../lib/money';
import { OrderSummary } from './order-summary';
import { OperatorWorkflow } from './operator-workflow';
import type { Order } from '../types/order';
import type { OperatorOrderDetail, OperatorOrderSummary } from '../types/operator-order';

export type OperatorReadState = { status: 'loading' } | { status: 'error'; code: string }
  | { status: 'list'; items: OperatorOrderSummary[] } | { status: 'detail'; order: OperatorOrderDetail };
export function OperatorStatusFilter({ admin, filter, onChange }: { admin: boolean; filter: Order['status'] | ''; onChange: (status: Order['status'] | '') => void }) {
  const statuses = admin ? Object.entries(orderStatusLabels) : [['PAID', 'Chờ pha chế'], ['PREPARING', 'Đang pha chế'], ['READY', 'Sẵn sàng']];
  return <div className="operator-filter"><label htmlFor="operator-status">Lọc theo trạng thái</label><select id="operator-status" value={filter}
    onChange={event => onChange(event.target.value as Order['status'] | '')}><option value="">{admin ? 'Tất cả trạng thái' : 'Tất cả đơn cần xử lý'}</option>
    {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>;
}
export function OperatorOrdersView({ id, completed = false, area = 'operator' }: { id?: string; completed?: boolean; area?: 'operator' | 'admin' }) {
  const { accessToken, user } = useAuthStore();
  if (!accessToken || !user || !['STAFF', 'ADMIN'].includes(user.role)) return null;
  return <OperatorReadSession key={`${accessToken}:${user.id}:${user.role}:${id ?? 'list'}:${completed}:${area}`} id={id} completed={completed} admin={area === 'admin' || user.role === 'ADMIN'} />;
}
function OperatorReadSession({ id, completed, admin }: { id?: string; completed: boolean; admin: boolean }) {
  const router = useRouter();
  const role = useAuthStore((s) => s.user?.role);
  const [locked, setLocked] = useState(false);
  const [filter, setFilter] = useState<Order['status'] | ''>(completed ? 'COMPLETED' : '');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<OperatorReadState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const load = id ? getOperatorOrder(id, controller.signal).then((order): OperatorReadState => ({ status: 'detail', order }))
      : getOperatorOrders(filter || undefined, controller.signal).then((items): OperatorReadState => ({ status: 'list', items }));
    void load.then((result) => { if (!controller.signal.aborted) setState(result); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setState({ status: 'error', code: error instanceof OrderError ? error.code : 'UNAVAILABLE' }); });
    return () => controller.abort();
  }, [id, filter, attempt]);
  function retry() { setState({ status: 'loading' }); setAttempt((value) => value + 1); }
  const basePath = admin ? '/admin/orders' : '/operator/orders';
  return <section className="operator-orders"><div className="operations-page-header"><p className="eyebrow">{admin ? 'Quản lý đơn' : 'Pha chế & giao tại quầy'}</p>
    <h1>{id ? 'Chi tiết đơn hàng' : completed ? 'Đã hoàn thành' : admin ? 'Đơn hàng' : 'Đơn cần xử lý'}</h1>
    <p className="section-note">{completed ? 'Lịch sử hoàn thành, chỉ xem.' : admin ? 'Theo dõi trạng thái, thanh toán và xử lý đơn hàng.' : 'Chờ pha chế → Đang pha chế → Sẵn sàng. Tải lại để đọc trạng thái mới nhất.'}</p></div>
    {!id && !completed && <OperatorStatusFilter admin={admin} filter={filter} onChange={status => { setState({ status: 'loading' }); setFilter(status); }} />}
    {id && <Link className="back-link" href={state.status === 'detail' && state.order.status === 'COMPLETED' && !admin ? '/operator/orders/completed' : basePath}>← Về danh sách đơn hàng</Link>}
    <OperatorReadContent state={state} retry={retry} locked={locked} basePath={basePath} workflow={id && role && state.status === 'detail' && state.order.status !== 'COMPLETED' ?
      <OperatorWorkflow order={state.order} role={role} onBusy={setLocked} onCurrent={(order) => {
        if (!admin && order.status === 'COMPLETED') { setState({ status: 'loading' }); router.replace('/operator/orders'); }
        else setState({ status: 'detail', order });
      }}
        onDenied={(code) => { setLocked(false); setState({ status: 'error', code }); }} /> : undefined} />
  </section>;
}
export function OperatorReadContent({ state, retry, locked = false, workflow, basePath = '/operator/orders' }: { state: OperatorReadState; retry: () => void; locked?: boolean; workflow?: ReactNode; basePath?: string }) {
  return <div className="order-read" aria-busy={state.status === 'loading'}>
    {state.status === 'loading' && <div className="state-panel" role="status" aria-live="polite"><div className="loading-mark" aria-hidden="true" /><p>Đang tải đơn hàng…</p></div>}
    {state.status === 'error' && <div className="state-panel" role="alert"><h3>{state.code === 'FORBIDDEN' ? 'Không có quyền truy cập'
      : state.code === 'UNAUTHORIZED' ? 'Phiên đăng nhập đã hết hạn' : state.code === 'ORDER_NOT_FOUND' ? 'Không tìm thấy đơn hàng' : 'Chưa tải được đơn hàng'}</h3>
      <p>{state.code === 'FORBIDDEN' ? 'Tài khoản của bạn không có quyền xem dữ liệu vận hành.' : state.code === 'UNAUTHORIZED' ? 'Vui lòng đăng nhập lại để đọc dữ liệu mới.'
        : state.code === 'ORDER_NOT_FOUND' ? 'Kiểm tra lại đường dẫn đơn hàng.' : 'Kết nối đang gián đoạn. Bạn thử lại sau một chút nhé.'}</p></div>}
    {state.status === 'list' && (state.items.length ? <OperatorOrderList items={state.items} basePath={basePath} />
      : <div className="state-panel" role="status"><h3>Không có đơn hàng</h3><p>Chưa có đơn hàng phù hợp để hiển thị.</p></div>)}
    {state.status === 'detail' && <OperatorOrderSnapshot order={state.order} />}
    {workflow}
    {!(state.status === 'error' && ['FORBIDDEN', 'UNAUTHORIZED'].includes(state.code)) && <button type="button" className="button" data-operator-retry
      disabled={state.status === 'loading' || locked} onClick={retry}>{state.status === 'error' ? 'Thử lại' : 'Tải lại đơn hàng'}</button>}
  </div>;
}
export function OperatorOrderList({ items, basePath = '/operator/orders' }: { items: OperatorOrderSummary[]; basePath?: string }) {
  return <ol className="order-history-list" aria-label="Đơn hàng vận hành">{items.map((order) => <li key={order.id} className="order-history-card" data-operator-order={order.id}>
    <h3>Đơn {order.orderCode}</h3><p className="order-status" data-order-status={order.status}>{orderStatusLabels[order.status]}</p>
    <p>Thời điểm đặt: <time dateTime={order.createdAt}>{formatOrderTime(order.createdAt)}</time></p><p>Tổng đơn: <strong>{formatVnd(order.total)}</strong></p>
    <p>Phiên bản: {order.version} · Cập nhật: <time dateTime={order.updatedAt}>{formatOrderTime(order.updatedAt)}</time></p>
    <p>Điểm từ đơn này: {order.earnedPoints === null ? 'Chưa phát sinh' : order.earnedPoints.toLocaleString('vi-VN')}</p>
    <Link className="button" href={`${basePath}/${order.id}`} aria-label={`Xem chi tiết đơn ${order.orderCode}`}>Xem chi tiết</Link>
  </li>)}</ol>;
}
export function OperatorOrderSnapshot({ order }: { order: OperatorOrderDetail }) {
  return <article className="order-confirmation" data-operator-detail={order.id}><OrderSummary order={order} localizedStatus />
    <dl className="order-metadata"><div><dt>Thời điểm đặt</dt><dd><time dateTime={order.createdAt}>{formatOrderTime(order.createdAt)}</time></dd></div>
      <div><dt>Phiên bản hiện tại</dt><dd>{order.version}</dd></div><div><dt>Cập nhật gần nhất</dt><dd><time dateTime={order.updatedAt}>{formatOrderTime(order.updatedAt)}</time></dd></div>
      {order.paidAt && <div><dt>Thời điểm thanh toán</dt><dd><time dateTime={order.paidAt}>{formatOrderTime(order.paidAt)}</time></dd></div>}
      <div><dt>Kết quả thanh toán gần nhất</dt><dd>{order.paymentStatus === 'SUCCEEDED' ? 'Thành công' : order.paymentStatus === 'FAILED' ? 'Thất bại' : 'Chưa có kết quả'}</dd></div>
      <div><dt>Điểm từ đơn này</dt><dd>{order.earnedPoints === null ? 'Chưa phát sinh' : order.earnedPoints.toLocaleString('vi-VN') + ' điểm'}</dd></div></dl>
    {order.status === 'CANCELLED' && <p>Đơn đã hủy. Trạng thái này không xác nhận việc hoàn tiền.</p>}
  </article>;
}

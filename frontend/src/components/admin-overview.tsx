'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { getOperatorOrders } from '../lib/api/operator-orders';
import { OrderError } from '../lib/api/orders';
import { orderStatusLabels } from '../lib/order-display';
import type { OperatorOrderSummary } from '../types/operator-order';

export function AdminOverview() {
  const { accessToken, user } = useAuthStore();
  if (!accessToken || user?.role !== 'ADMIN') return null;
  return <OverviewSession key={`${accessToken}:${user.id}:${user.role}`} />;
}
export function OverviewCounts({ items }: { items: OperatorOrderSummary[] }) {
  return <dl className="overview-grid">{Object.entries(orderStatusLabels).map(([status, label]) => <div key={status}><dt>{label}</dt><dd>{items.filter(order => order.status === status).length}</dd></div>)}</dl>;
}
function OverviewSession() {
  const [items, setItems] = useState<OperatorOrderSummary[] | null>(null);
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void getOperatorOrders(undefined, abort.signal).then(rows => { if (!abort.signal.aborted) setItems(rows); })
      .catch((e: unknown) => { if (!abort.signal.aborted) setError(e instanceof OrderError ? e.code : 'UNAVAILABLE'); });
    return () => abort.abort();
  }, [attempt]);
  return <section><div className="operations-page-header"><p className="eyebrow">BrewLite / Quản trị</p><h1>Tổng quan</h1><p className="section-note">Số đơn theo trạng thái tại lần tải gần nhất.</p></div>
    {items === null && !error && <p role="status">Đang tải tổng quan…</p>}
    {error && <p role="alert">{error === 'FORBIDDEN' ? 'Không có quyền xem dữ liệu quản trị.' : error === 'UNAUTHORIZED' ? 'Phiên đăng nhập đã hết hạn.' : 'Chưa tải được tổng quan. Hãy thử lại.'}</p>}
    {items && <OverviewCounts items={items} />}
    {!['FORBIDDEN', 'UNAUTHORIZED'].includes(error) && <button className="button" disabled={items === null && !error} onClick={() => { setItems(null); setError(''); setAttempt(a => a + 1); }}>{error ? 'Thử lại' : 'Tải lại tổng quan'}</button>}
    <div className="overview-links"><Link href="/admin/orders"><h2>Đơn hàng</h2><p>Xem toàn bộ trạng thái và xử lý đơn.</p></Link><Link href="/admin/products"><h2>Sản phẩm</h2><p>Quản lý danh mục, giá và trạng thái kinh doanh.</p></Link></div>
  </section>;
}

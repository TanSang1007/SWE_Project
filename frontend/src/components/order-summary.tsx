'use client';
import { formatVnd } from '../lib/money';
import { orderStatusLabels } from '../lib/order-display';
import type { Order } from '../types/order';
export function OrderSummary({ order, localizedStatus = false }: { order: Order; localizedStatus?: boolean }) {
  return <section className="order-summary" aria-labelledby="order-summary-heading"><h3 id="order-summary-heading">Đơn {order.orderCode}</h3><p data-order-status={order.status}>Trạng thái: {localizedStatus ? orderStatusLabels[order.status] : order.status}</p>
    <p>Chi tiết và tổng tiền bên dưới được giữ theo đơn đã đặt.</p>
    <ul>{order.items.map((i, index) => <li key={index}><strong>{i.productName}</strong><p>Size {i.size} · {i.qty} ly</p>
      <p>Topping: {i.toppings.map((t) => t.name + ' (' + formatVnd(t.price) + ')').join(', ') || 'Không topping'}</p>
      <p>Đơn giá: {formatVnd(i.unitPrice)} / ly · Thành tiền: {formatVnd(i.lineTotal)}</p></li>)}</ul>
    <dl className="order-totals"><div><dt>Tạm tính</dt><dd>{formatVnd(order.subtotal)}</dd></div>
      <div><dt>Giảm giá cố định{order.promotionCode ? ' (' + order.promotionCode + ')' : ''}</dt><dd>{formatVnd(order.discountAmount)}</dd></div>
      {(order.redeemedPoints ?? 0) > 0 && <div><dt>Giảm từ {order.redeemedPoints} điểm tích lũy</dt><dd>{formatVnd(order.loyaltyDiscountAmount!)}</dd></div>}
      {order.estimatedEarnedPoints !== undefined && <div><dt>Điểm dự kiến khi thanh toán thành công</dt><dd>{order.estimatedEarnedPoints}</dd></div>}
      <div><dt>Tổng đơn</dt><dd>{formatVnd(order.total)}</dd></div></dl>
  </section>;
}

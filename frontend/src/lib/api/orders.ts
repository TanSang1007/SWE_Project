import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import type { Order, OrderInput } from '../../types/order';
export class OrderError extends Error {
  constructor(public readonly code: string, public readonly existingOrderId?: string) { super(code); }
}
export async function orderRequest(path: string, method = 'GET', body?: OrderInput, key?: string): Promise<Order> {
  const token = getAccessToken(); if (!token) throw new OrderError('UNAUTHORIZED');
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, { method, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 401) { if (useAuthStore.getState().accessToken === token) useAuthStore.getState().clear(); throw new OrderError('UNAUTHORIZED'); }
    const value = await res.json();
    if (!res.ok) {
      const id = value?.error?.details?.existingOrderId;
      throw new OrderError(value?.error?.code ?? 'UNAVAILABLE', typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
    }
    if (useAuthStore.getState().accessToken !== token) throw new OrderError('UNAUTHORIZED');
    const order = parseOrder(value);
    if (body && (body.redeemedPoints ?? 0) > 0 && order.redeemedPoints !== body.redeemedPoints) throw new OrderError('UNAVAILABLE');
    return order;
  } catch (error) { if (error instanceof OrderError) throw error; throw new OrderError('UNAVAILABLE'); }
}
export function parseOrder(value: unknown): Order {
  const money = (v: unknown) => typeof v === 'string' && /^(0|[1-9]\d{0,11})$/.test(v);
  if (!value || typeof value !== 'object') throw new OrderError('UNAVAILABLE');
  const o = value as Order;
  if (typeof o.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(o.id) || typeof o.orderCode !== 'string'
    || !['PENDING', 'PAYMENT_FAILED', 'CANCELLED', 'PAID', 'PREPARING', 'READY', 'COMPLETED'].includes(o.status)
    || o.currency !== 'VND' || !money(o.subtotal) || !money(o.discountAmount) || !money(o.total)
    || typeof o.createdAt !== 'string' || !Number.isFinite(Date.parse(o.createdAt))
    || !(o.promotionCode === null || typeof o.promotionCode === 'string') || !Array.isArray(o.items) || !o.items.length) throw new OrderError('UNAVAILABLE');
  const hasLoyalty = ['redeemedPoints','loyaltyDiscountAmount','redemptionState','estimatedEarnedPoints'].some(k => Object.hasOwn(o,k));
  if (hasLoyalty && (!Number.isInteger(o.redeemedPoints) || o.redeemedPoints! < 0 || o.redeemedPoints! > 2147483647
    || !money(o.loyaltyDiscountAmount) || !['NONE','RESERVED','RELEASED','SETTLED','REFUNDED'].includes(o.redemptionState!)
    || !Number.isInteger(o.estimatedEarnedPoints) || BigInt(o.total)/10000n !== BigInt(o.estimatedEarnedPoints!)
    || BigInt(o.redeemedPoints!)*100n !== BigInt(o.loyaltyDiscountAmount!))) throw new OrderError('UNAVAILABLE');
  if (hasLoyalty && BigInt(o.subtotal)-BigInt(o.discountAmount)-BigInt(o.loyaltyDiscountAmount!) !== BigInt(o.total)) throw new OrderError('UNAVAILABLE');
  const loyalty = hasLoyalty ? {redeemedPoints:o.redeemedPoints,loyaltyDiscountAmount:o.loyaltyDiscountAmount,redemptionState:o.redemptionState,estimatedEarnedPoints:o.estimatedEarnedPoints} : {};
  const items = o.items.map((i) => {
    if (!i || typeof i.productId !== 'string' || typeof i.productName !== 'string' || !['S', 'M', 'L'].includes(i.size)
      || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99 || !money(i.unitPrice) || !money(i.lineTotal)
      || !Array.isArray(i.toppings) || i.toppings.some((t) => !t || typeof t.name !== 'string' || !money(t.price))) throw new OrderError('UNAVAILABLE');
    return { productId: i.productId, productName: i.productName, size: i.size, qty: i.qty, unitPrice: i.unitPrice, lineTotal: i.lineTotal,
      toppings: i.toppings.map((t) => ({ name: t.name, price: t.price })) };
  });
  return { id: o.id, orderCode: o.orderCode, status: o.status, currency: o.currency, items, subtotal: o.subtotal,
    discountAmount: o.discountAmount, total: o.total, promotionCode: o.promotionCode, createdAt: o.createdAt, ...loyalty };
}
export function orderErrorMessage(error: unknown) {
  const code = error instanceof OrderError ? error.code : 'UNAVAILABLE';
  if (code === 'OUT_OF_STOCK') return 'Không đủ tồn kho. Giỏ vẫn được giữ nguyên.';
  if (code === 'PRODUCT_UNAVAILABLE') return 'Món đã ngừng bán. Giỏ vẫn được giữ nguyên; hãy điều chỉnh hoặc xóa dòng này.';
  if (code === 'CONCURRENT_UPDATE') return 'Giỏ hoặc tồn kho đã thay đổi. Đã tải lại giỏ; hãy xác nhận lại.';
  if (code === 'INVALID_ITEM_OPTIONS') return 'Tùy chọn không còn hợp lệ. Giỏ vẫn được giữ nguyên.';
  if (code === 'VALIDATION_ERROR') return 'Giỏ hoặc yêu cầu không hợp lệ. Vui lòng kiểm tra lại.';
  if (code === 'PROMOTION_INVALID') return 'Mã giảm giá không hợp lệ hoặc chưa đủ điều kiện.';
  if (code === 'INVALID_ORDER_STATE') return 'Bạn đang có đơn chưa hoàn tất. Hãy mở hoặc hủy đơn hiện tại.';
  if (code === 'IDEMPOTENCY_KEY_REUSED') return 'Yêu cầu cũ có nội dung khác. Hãy kiểm tra đơn trước khi tiếp tục.';
  if (code === 'UNAUTHORIZED') return 'Vui lòng đăng nhập lại.';
  if (code === 'ORDER_ALREADY_PAID') return 'Đơn đã thanh toán. Hãy tải lại trạng thái hiện tại.';
  if (code === 'PAYMENT_UNAVAILABLE' || code === 'IDEMPOTENCY_IN_PROGRESS') return 'Chưa xác nhận được kết quả thanh toán. Thử lại cùng yêu cầu.';
  return 'Chưa xác nhận được kết quả. Thử lại cùng yêu cầu để tránh tạo đơn trùng.';
}

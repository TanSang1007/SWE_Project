import type { Order } from '../types/order';
export const validOrderId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const orderStatusLabels: Record<Order['status'], string> = {
  PENDING: 'Chờ thanh toán', PAYMENT_FAILED: 'Thanh toán thất bại', PAID: 'Đã thanh toán',
  CANCELLED: 'Đã hủy', PREPARING: 'Đang pha chế', READY: 'Sẵn sàng nhận tại quầy', COMPLETED: 'Đã hoàn tất',
};
export function formatOrderTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
}

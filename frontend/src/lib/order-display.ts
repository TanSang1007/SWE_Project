import type { Order } from '../types/order';
export const validOrderId = (value: string) => /^[A-Za-z0-9_-]{1,64}$/.test(value);
export const orderStatusLabels: Record<Order['status'], string> = {
  PENDING: 'Chờ thanh toán', PAYMENT_FAILED: 'Thanh toán thất bại', PAID: 'Đã thanh toán',
  CANCELLED: 'Đã hủy', PREPARING: 'Đang pha chế', READY: 'Sẵn sàng nhận tại quầy', COMPLETED: 'Đã hoàn tất',
};
export function formatOrderTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
}

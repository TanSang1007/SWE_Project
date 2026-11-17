import { ConflictException } from '@nestjs/common';

// O01: khách hủy trong [paidAt, paidAt+120s) nếu chưa xác nhận không hủy;
// Staff/Admin có thể bắt đầu pha chế bất kỳ lúc nào sau khi đơn PAID.
// Hết đồng hồ không tự đổi PAID. Backend quyết định bằng giờ server.
export const PAID_CANCEL_WINDOW_MS = 120_000;
type WindowOrder = { status: string; paidAt: Date | null; noCancelConfirmedAt?: Date | null };
export function cancellationWindow(order: WindowOrder, now = new Date()) {
  const until = order.paidAt ? new Date(order.paidAt.getTime() + PAID_CANCEL_WINDOW_MS) : null;
  const beforeDeadline = !!until && now >= order.paidAt! && now < until;
  const noCancelConfirmedAt = order.noCancelConfirmedAt ?? null;
  return {
    cancelUntil: until?.toISOString() ?? null,
    noCancelConfirmedAt: noCancelConfirmedAt?.toISOString() ?? null,
    canCancelPaid: order.status === 'PAID' && beforeDeadline && !noCancelConfirmedAt,
    canStartPreparing: order.status === 'PAID' && !!order.paidAt,
  };
}
export function assertPaidCancellation(order: WindowOrder, now = new Date()) {
  if (order.status === 'PAID' && order.noCancelConfirmedAt) {
    throw new ConflictException({ code: 'CANCEL_CONFIRMED', message: 'Bạn đã xác nhận không hủy đơn để nhân viên pha chế ngay. Bạn có thể gửi yêu cầu hỗ trợ.' });
  }
  if (!cancellationWindow(order, now).canCancelPaid) throw new ConflictException({ code: 'CANCEL_WINDOW_EXPIRED', message: 'Đã hết thời hạn hủy 120 giây. Bạn có thể gửi yêu cầu hỗ trợ.' });
}
export function assertPreparationReady(order: WindowOrder, now = new Date()) {
  if (!cancellationWindow(order, now).canStartPreparing) throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Đơn hàng chưa sẵn sàng để bắt đầu pha chế.' });
}

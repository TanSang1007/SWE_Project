import { ConflictException } from '@nestjs/common';

// O01 đã chốt: khách hủy trong [paidAt, paidAt+120s); đúng 120s chỉ cho Staff
// bắt đầu pha chế. Hết đồng hồ không tự đổi PAID. Backend quyết định bằng giờ
// server; frontend chỉ đếm từ serverNow + thời gian đã trôi, không dùng giờ máy.
// Ranh giới và trạng thái được kiểm tra tại test/cancellation-window.spec.ts.
export const PAID_CANCEL_WINDOW_MS = 120_000;
export function cancellationWindow(order: { status: string; paidAt: Date | null }, now = new Date()) {
  const until = order.paidAt ? new Date(order.paidAt.getTime() + PAID_CANCEL_WINDOW_MS) : null;
  const beforeDeadline = !!until && now >= order.paidAt! && now < until;
  return { cancelUntil: until?.toISOString() ?? null,
    canCancelPaid: order.status === 'PAID' && beforeDeadline,
    canStartPreparing: order.status === 'PAID' && !!until && now >= until };
}
export function assertPaidCancellation(order: { status: string; paidAt: Date | null }, now = new Date()) {
  if (!cancellationWindow(order, now).canCancelPaid) throw new ConflictException({ code: 'CANCEL_WINDOW_EXPIRED', message: 'Đã hết thời hạn hủy 120 giây. Bạn có thể gửi yêu cầu hỗ trợ.' });
}
export function assertPreparationReady(order: { status: string; paidAt: Date | null }, now = new Date()) {
  if (!cancellationWindow(order, now).canStartPreparing) throw new ConflictException({ code: 'PREPARATION_LOCKED', message: 'Chờ hết thời hạn hủy 120 giây trước khi bắt đầu pha chế.' });
}

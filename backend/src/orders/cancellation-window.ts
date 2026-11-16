import { ConflictException } from '@nestjs/common';

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

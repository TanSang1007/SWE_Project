'use client';
import Link from 'next/link';
import { useAuthStore } from '../lib/auth-store';
import { useCancellationNotice } from '../lib/cancellation-notice';
import { paymentMessage } from '../lib/payment-result';
import type { AttemptStatus } from '../lib/api/gateway-payments';

export function CancellationNotice() {
  const token = useAuthStore(s => s.accessToken);
  const notice = useCancellationNotice(s => s.notice);
  return <CancellationNoticeContent token={token} notice={notice} />;
}
export function CancellationNoticeContent({ token, notice }: { token: string | null; notice: { token: string; status: AttemptStatus } | null }) {
  if (!token || notice?.token !== token) return null;
  return <section role="status" aria-label="Thông báo thanh toán">
    <p>{paymentMessage(notice.status)} Trạng thái đơn hàng được hiển thị riêng trong chi tiết đơn.</p>
    <Link href={`/orders/${notice.status.orderId}/confirmation`}>Xem đơn hàng</Link>
    <button type="button" onClick={() => useCancellationNotice.setState({ notice: null })}>Đóng thông báo</button>
  </section>;
}

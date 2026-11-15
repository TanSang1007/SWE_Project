'use client';
import { useEffect } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { useCancellationNotice } from '../lib/cancellation-notice';
import { notifyCenterPopup } from '../lib/notification-store';
import type { AttemptStatus } from '../lib/api/gateway-payments';

export function CancellationNotice() {
  const token = useAuthStore(s => s.accessToken);
  const notice = useCancellationNotice(s => s.notice);
  return <CancellationNoticeContent token={token} notice={notice} />;
}
export function CancellationNoticeContent({ token, notice }: { token: string | null; notice: { token: string; status: AttemptStatus } | null }) {
  useEffect(() => {
    if (!token || notice?.token !== token) return;
    const status = notice.status;
    useCancellationNotice.setState({ notice: null });
    notifyCenterPopup({
      tone: 'error',
      title: 'Thanh toán không thành công',
      message: 'Giao dịch chưa được hoàn tất.',
      actions: [
        { label: 'Xem chi tiết đơn', href: `/orders/${status.orderId}/confirmation`, variant: 'primary' },
        { label: 'Đóng', variant: 'secondary' },
      ],
    });
  }, [token, notice]);
  return null;
}

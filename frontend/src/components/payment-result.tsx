'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../lib/auth-store';
import { attemptStatus, type AttemptStatus } from '../lib/api/gateway-payments';
import { OrderError } from '../lib/api/orders';
import { paymentMessage, pollPayment, resultPath } from '../lib/payment-result';
import { formatVnd } from '../lib/money';
import { notifyCenterPopup } from '../lib/notification-store';

export function PaymentResultContent({ status }: { status: AttemptStatus }) {
  return <div className="payment-result-card">
    <p role="status" className={`gateway-status-pill gateway-status-${status.effectiveState.toLowerCase()}`}>{paymentMessage(status)}</p>
    <p className="payment-result-amount">Số tiền: <strong>{formatVnd(status.amount)}</strong></p>
    {status.orderStatus === 'CANCELLED' && status.effectiveState === 'SUCCEEDED' && <p>Đơn hàng đã hủy. Thanh toán đã được ghi nhận.</p>}
    <div className="checkout-action-group">
      <Link className="brew-btn brew-btn-primary" href={`/orders/${status.orderId}/confirmation`}>Xem chi tiết đơn</Link>
      {status.effectiveState === 'FAILED' && status.canRetry && !status.requiresReview && (
        <Link className="brew-btn brew-btn-secondary" href={`/checkout?orderId=${status.orderId}`}>Thanh toán lại</Link>
      )}
      <Link className="brew-btn brew-btn-outline" href="/orders">Lịch sử đơn hàng</Link>
    </div>
  </div>;
}
export function PaymentResult({ attemptId }: { attemptId?: string }) {
  const token = useAuthStore(s => s.accessToken), role = useAuthStore(s => s.user?.role);
  const [state, setState] = useState<{ token: string; status: AttemptStatus } | null>(null);
  const [error, setError] = useState(''), [ended, setEnded] = useState(false), [cycle, setCycle] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const popupShownRef = useRef<string | null>(null);
  useEffect(() => {
    if (!token || role !== 'CUSTOMER' || !attemptId) return;
    return pollPayment(signal => attemptStatus(attemptId, signal), a => { setState({ token, status: a }); setError(''); setRequesting(false); }, e => {
      setRequesting(false);
      setError(e instanceof OrderError && ['PAYMENT_ATTEMPT_NOT_FOUND', 'FORBIDDEN'].includes(e.code)
        ? 'Không tìm thấy kết quả thanh toán của tài khoản này.' : 'Chưa đọc được kết quả thanh toán.');
    }, () => setEnded(true));
  }, [token, role, attemptId, cycle]);
  const status = state?.token === token ? state.status : null;

  useEffect(() => {
    if (!status) return;
    const key = `${status.attemptId}:${status.effectiveState}`;
    if (popupShownRef.current === key) return;
    if (status.effectiveState === 'SUCCEEDED') {
      popupShownRef.current = key;
      notifyCenterPopup({
        tone: 'success',
        title: 'Thanh toán thành công',
        message: 'Giao dịch của bạn đã được xác nhận thành công.',
        total: formatVnd(status.amount),
        actions: [
          { label: 'Xem chi tiết đơn', href: `/orders/${status.orderId}/confirmation`, variant: 'primary' },
          { label: 'Về thực đơn', href: '/', variant: 'secondary' },
        ],
      });
    } else if (status.effectiveState === 'FAILED') {
      popupShownRef.current = key;
      notifyCenterPopup({
        tone: 'error',
        title: 'Thanh toán thất bại',
        message: 'Giao dịch không thành công. Bạn có thể thử thanh toán lại hoặc kiểm tra đơn hàng.',
        total: formatVnd(status.amount),
        actions: [
          ...(status.canRetry && !status.requiresReview
            ? [{ label: 'Thanh toán lại', href: `/checkout?orderId=${status.orderId}`, variant: 'primary' as const }]
            : []),
          { label: 'Xem đơn hàng', href: `/orders/${status.orderId}/confirmation`, variant: 'secondary' as const },
        ],
      });
    }
  }, [status]);

  return <section className="order-checkout payment-result" aria-labelledby="payment-result-heading">
    <h1 id="payment-result-heading">Kết quả thanh toán</h1>
    {!attemptId ? <p role="alert">Không có thông tin thanh toán hợp lệ.</p>
      : !token ? <div className="checkout-action-group"><p>Vui lòng đăng nhập để kiểm tra kết quả thanh toán.</p><Link className="brew-btn brew-btn-primary" href={'/login?returnTo=' + encodeURIComponent(resultPath(attemptId))}>Đăng nhập</Link></div>
        : role !== 'CUSTOMER' ? <p role="alert">Vui lòng sử dụng tài khoản khách hàng sở hữu đơn.</p>
          : <>{status ? <PaymentResultContent status={status} /> : !error && <p role="status">Đang xác minh kết quả thanh toán…</p>}
            {error && <p role="alert" className="checkout-error">{error}</p>}
            {(error || ended || (status && status.effectiveState !== 'AWAITING')) && (
              <div className="checkout-action-group">
                <button type="button" className="brew-btn brew-btn-secondary" disabled={requesting} onClick={() => { setRequesting(true); setError(''); setEnded(false); setCycle(v => v + 1); }}>Làm mới trạng thái</button>
              </div>
            )}</>}
  </section>;
}

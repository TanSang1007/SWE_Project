'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { navigateAfterCancellation } from '../lib/cancellation-notice';
import { useAuthStore } from '../lib/auth-store';
import { attemptStatus, type AttemptStatus } from '../lib/api/gateway-payments';
import { OrderError } from '../lib/api/orders';
import { paymentMessage, pollPayment, resultPath } from '../lib/payment-result';
import { verifiedCustomerCancellation } from '../lib/payment-result';

function CancellationNavigation({ status, token }: { status: AttemptStatus; token: string }) {
  const router = useRouter();
  useEffect(() => {
    if (useAuthStore.getState().accessToken === token) navigateAfterCancellation(status, token, path => router.replace(path));
  }, [status, token, router]);
  return null;
}

export function PaymentResultContent({ status }: { status: AttemptStatus }) {
  return <><p role="status">{paymentMessage(status)}</p>
    {status.orderStatus === 'CANCELLED' && status.effectiveState === 'SUCCEEDED' && <p>Đơn đã hủy. Thanh toán đã ghi nhận, BrewLite chưa tự hoàn tiền.</p>}
    <Link href={`/orders/${status.orderId}/confirmation`}>Xem đơn hàng</Link>
    {status.effectiveState === 'FAILED' && status.canRetry && !status.requiresReview && <Link href={`/cart?orderId=${status.orderId}`}>Mở đơn để thanh toán lại</Link>}
  </>;
}
export function PaymentResult({ attemptId }: { attemptId?: string }) {
  const token = useAuthStore(s => s.accessToken), role = useAuthStore(s => s.user?.role);
  const [state, setState] = useState<{ token: string; status: AttemptStatus } | null>(null);
  const [error, setError] = useState(''), [ended, setEnded] = useState(false), [cycle, setCycle] = useState(0);
  const [requesting, setRequesting] = useState(false);
  useEffect(() => {
    if (!token || role !== 'CUSTOMER' || !attemptId) return;
    return pollPayment(signal => attemptStatus(attemptId, signal), a => { setState({ token, status: a }); setError(''); setRequesting(false); }, e => {
      setRequesting(false);
      setError(e instanceof OrderError && ['PAYMENT_ATTEMPT_NOT_FOUND', 'FORBIDDEN'].includes(e.code)
        ? 'Không tìm thấy kết quả thanh toán của tài khoản này.' : 'Chưa đọc được kết quả. Vui lòng kiểm tra lại sau.');
    }, () => setEnded(true));
  }, [token, role, attemptId, cycle]);
  const status = state?.token === token ? state.status : null;
  return <section className="order-checkout payment-result" aria-labelledby="payment-result-heading">
    {status && token && verifiedCustomerCancellation(status) && <CancellationNavigation status={status} token={token} />}
    <h1 id="payment-result-heading">Kết quả thanh toán</h1>
    {!attemptId ? <p role="alert">Không có thông tin thanh toán hợp lệ. Vui lòng đăng nhập và kiểm tra đơn hàng.</p>
      : !token ? <><p>Vui lòng đăng nhập để kiểm tra kết quả thanh toán.</p><Link href={'/login?returnTo=' + encodeURIComponent(resultPath(attemptId))}>Đăng nhập để kiểm tra</Link></>
        : role !== 'CUSTOMER' ? <p role="alert">Vui lòng sử dụng tài khoản khách hàng sở hữu đơn.</p>
          : <>{status ? <PaymentResultContent status={status} /> : !error && <p role="status">Đang xác minh kết quả thanh toán.</p>}
            {error && <p role="alert">{error}</p>}{ended && <p>Chưa có kết quả mới. Bạn có thể chủ động kiểm tra lại; thời gian chờ không có nghĩa thanh toán thất bại.</p>}
            {(error || ended || (status && status.effectiveState !== 'AWAITING')) && <button type="button" disabled={requesting} onClick={() => { setRequesting(true); setError(''); setEnded(false); setCycle(v => v + 1); }}>Kiểm tra lại trạng thái</button>}</>}
    <p><Link href="/orders">Lịch sử đơn hàng</Link></p>
  </section>;
}

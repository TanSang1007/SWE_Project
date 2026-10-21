'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Order } from '../types/order';
import { useAuthStore } from '../lib/auth-store';
import { attemptStatus, confirmZero, currentAttempt, initiatePayment, type AttemptStatus } from '../lib/api/gateway-payments';
import { readGatewayContext, writeGatewayContext, clearGatewayContext, gatewayPermission, nextGatewayIntent, type GatewayContext } from '../lib/gateway-context';
import { checkoutErrorMessage } from '../lib/checkout-policy';
import { paymentMessage, resultPath } from '../lib/payment-result';
import { formatVnd } from '../lib/money';

export function GatewayCheckout({ order, disabled, acceptingNewPayments = true, onBusy, onConfirmed, onCancel }: {
  acceptingNewPayments?: boolean;
  order: Order; disabled: boolean; onBusy: (v: boolean) => void; onConfirmed: () => Promise<void>; onCancel: () => Promise<void>;
}) {
  const token = useAuthStore(s => s.accessToken), userId = useAuthStore(s => s.user?.id);
  const [status, setStatus] = useState<AttemptStatus | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  const [recovery, setRecovery] = useState<GatewayContext | null>(null);
  const intent = useRef<GatewayContext | null>(null), inFlight = useRef(false), alive = useRef(true);
  const zero = order.total === '0';
  const current = () => alive.current && useAuthStore.getState().accessToken === token;
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    void (async () => {
      await Promise.resolve(); setLoading(true); setError(''); setStatus(null); intent.current = null; setRecovery(null);
      try {
        if (!userId) return;
        intent.current = readGatewayContext(userId, order.id);
        setRecovery(intent.current);
        const a = await currentAttempt(order.id, controller.signal);
        if (!controller.signal.aborted && useAuthStore.getState().accessToken === token) setStatus(a);
      } catch { if (!controller.signal.aborted) setError('Chưa khôi phục được yêu cầu thanh toán. Hãy kiểm tra lại; không tạo yêu cầu mới.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { alive.current = false; controller.abort(); };
  }, [order.id, token, userId, version]);
  // Current capabilities come from the backend; a stored key only permits exact replay.
  const matching = !!recovery && (!status || !recovery.attemptId || recovery.attemptId === status.attemptId);
  const permitted = gatewayPermission(order, status, recovery);
  async function pay() {
    if (!userId || inFlight.current || loading || disabled || error || !permitted || (!zero && !acceptingNewPayments)) return;
    inFlight.current = true; setBusy(true); onBusy(true); setError('');
    try {
      let saved = nextGatewayIntent(userId, order, status, intent.current);
      writeGatewayContext(saved); intent.current = saved; setRecovery(saved);
      if (zero) {
        await confirmZero(order.id, saved.key); if (!current()) return;
        await onConfirmed(); if (!current()) return; clearGatewayContext();
      } else {
        const r = await initiatePayment(order.id, saved.key); if (!current()) return;
        saved = { ...saved, attemptId: r.attemptId }; intent.current = saved; setRecovery(saved); writeGatewayContext(saved);
        const a = await attemptStatus(r.attemptId); if (!current()) return; setStatus(a);
        if (!a.canResume || a.effectiveState !== 'AWAITING' || a.requiresReview) { window.location.assign(resultPath(a.attemptId)); return; }
        // URL stays in this call's memory only. A failed navigation keeps the same intent.
        window.location.assign(r.paymentUrl);
        setError('Nếu chưa chuyển trang, hãy kiểm tra trạng thái hoặc tiếp tục cùng yêu cầu đã lưu.');
      }
    } catch (e) { if (current()) setError(checkoutErrorMessage(e, 'payment')); }
    finally { inFlight.current = false; onBusy(false); if (current()) setBusy(false); }
  }
  return <div className="gateway-checkout" aria-busy={loading || busy}>
    <p>Tổng đơn: {formatVnd(order.total)}.</p>
    {zero ? <p>Đơn 0 VND được xác nhận nội bộ, không chuyển tới cổng thanh toán.</p>
      : <p>Bạn sẽ được chuyển đến cổng thanh toán thử nghiệm. Khi quay về, có thể cần đăng nhập lại.</p>}
    {loading && <p role="status">Đang khôi phục trạng thái thanh toán…</p>}
    {status && <p role="status">{paymentMessage(status)}</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" data-checkout-action="gateway-payment" disabled={disabled || loading || busy || !!error || !permitted || (!zero && !acceptingNewPayments)} onClick={() => void pay()}>{zero ? 'Xác nhận đơn 0 VND' : 'Thanh toán'}</button>
    <button type="button" disabled={loading || busy || disabled} onClick={() => setVersion(v => v + 1)}>Kiểm tra lại trạng thái</button>
    {status && <Link href={resultPath(status.attemptId)}>Xem kết quả thanh toán</Link>}
    {status?.canResume && !matching && <p>Đã có giao dịch đang chờ. Chưa có khóa để tiếp tục trong tab này; vui lòng kiểm tra kết quả, không tạo giao dịch mới.</p>}
    {(!status ? !recovery : status.canCancel && !status.requiresReview && status.effectiveState === 'FAILED') && !loading && !error && <button type="button" disabled={disabled || busy} onClick={() => void onCancel()}>Hủy đơn chưa thanh toán</button>}
  </div>;
}

'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Order } from '../types/order';
import { useAuthStore } from '../lib/auth-store';
import { resumePayment, attemptStatus, confirmZero, currentAttempt, initiatePayment, type AttemptStatus } from '../lib/api/gateway-payments';
import { readGatewayContext, writeGatewayContext, clearGatewayContext, gatewayPermission, nextGatewayIntent, type GatewayContext } from '../lib/gateway-context';
import { checkoutErrorMessage } from '../lib/checkout-policy';
import { paymentMessage, resultPath } from '../lib/payment-result';
import { formatVnd } from '../lib/money';
import { notifyCenterPopup, notifyToast } from '../lib/notification-store';

export function GatewayCheckout({ order, disabled, acceptingNewPayments = true, autoStart = false, onAutoStartHandled, onBusy, onConfirmed, onCancel }: {
  acceptingNewPayments?: boolean;
  autoStart?: boolean;
  onAutoStartHandled?: () => void;
  order: Order; disabled: boolean; onBusy: (v: boolean) => void; onConfirmed: () => Promise<void>; onCancel: () => Promise<void>;
}) {
  const token = useAuthStore(s => s.accessToken), userId = useAuthStore(s => s.user?.id);
  const [status, setStatus] = useState<AttemptStatus | null>(null), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  const [recovery, setRecovery] = useState<GatewayContext | null>(null);
  const intent = useRef<GatewayContext | null>(null), inFlight = useRef(false), alive = useRef(true);
  const autoStartedRef = useRef(false);
  const notifiedAttemptRef = useRef<string | null>(null);
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
      } catch { if (!controller.signal.aborted) setError('Chưa khôi phục được yêu cầu thanh toán.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => { alive.current = false; controller.abort(); };
  }, [order.id, token, userId, version]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setInterval(() => {
      void currentAttempt(order.id, controller.signal).then(value => {
        if (controller.signal.aborted || useAuthStore.getState().accessToken !== token) return;
        setStatus(value);
        if (value && value.orderStatus !== order.status) void onConfirmed();
      }).catch(() => {});
    }, 5000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [order.id, order.status, token, onConfirmed]);

  useEffect(() => {
    if (!status) return;
    const key = `${status.attemptId}:${status.effectiveState}`;
    if (notifiedAttemptRef.current === key) return;
    if (status.effectiveState === 'SUCCEEDED') {
      notifiedAttemptRef.current = key;
      notifyCenterPopup({
        tone: 'success',
        title: 'Thanh toán thành công',
        message: 'Đơn hàng của bạn đã được xác nhận thanh toán.',
        orderCode: order.customerOrderCode,
        total: formatVnd(order.total),
        actions: [
          { label: 'Xem chi tiết đơn', href: `/orders/${order.id}/confirmation`, variant: 'primary' },
          { label: 'Đóng', variant: 'secondary' },
        ],
      });
    } else if (status.effectiveState === 'FAILED') {
      notifiedAttemptRef.current = key;
      notifyCenterPopup({
        tone: 'error',
        title: 'Thanh toán thất bại',
        message: 'Giao dịch chưa hoàn tất. Bạn có thể thanh toán lại hoặc hủy đơn.',
        orderCode: order.customerOrderCode,
        total: formatVnd(order.total),
        actions: [{ label: 'Đóng', variant: 'primary' }],
      });
    }
  }, [status, order.id, order.customerOrderCode, order.total]);

  // Current capabilities come from the backend; a stored key only permits exact replay.
  const permitted = gatewayPermission(order, status, recovery);
  async function pay() {
    if (!userId || inFlight.current || loading || disabled || error || !permitted || (!zero && !acceptingNewPayments)) return;
    inFlight.current = true; setBusy(true); onBusy(true); setError('');
    try {
      if (!zero && status?.canResume) { const url = await resumePayment(order.id); if (current()) { window.location.href = url; } return; }
      let saved = nextGatewayIntent(userId, order, status, intent.current);
      writeGatewayContext(saved); intent.current = saved; setRecovery(saved);
      if (zero) {
        await confirmZero(order.id, saved.key); if (!current()) return;
        await onConfirmed(); if (!current()) return; clearGatewayContext();
        notifyCenterPopup({
          tone: 'success',
          title: 'Thanh toán thành công',
          message: 'Đơn hàng 0 VND đã được xác nhận thành công.',
          orderCode: order.customerOrderCode,
          total: formatVnd(order.total),
          actions: [
            { label: 'Xem chi tiết đơn', href: `/orders/${order.id}/confirmation`, variant: 'primary' },
            { label: 'Về thực đơn', href: '/', variant: 'secondary' },
          ],
        });
      } else {
        const r = await initiatePayment(order.id, saved.key); if (!current()) return;
        saved = { ...saved, attemptId: r.attemptId }; intent.current = saved; setRecovery(saved); writeGatewayContext(saved);
        const a = await attemptStatus(r.attemptId); if (!current()) return; setStatus(a);
        if (!a.canResume || a.effectiveState !== 'AWAITING' || a.requiresReview) { window.location.href = resultPath(a.attemptId); return; }
        window.location.href = r.paymentUrl;
      }
    } catch (e) {
      if (current()) {
        const msg = checkoutErrorMessage(e, 'payment');
        setError(msg);
        notifyToast(msg, 'error');
      }
    }
    finally { inFlight.current = false; onBusy(false); if (current()) setBusy(false); }
  }
  useEffect(() => {
    if (!autoStart || autoStartedRef.current || loading || busy || disabled || !!error || !permitted || (!zero && !acceptingNewPayments)) return;
    autoStartedRef.current = true;
    onAutoStartHandled?.();
    void pay();
  });
  return <div className="gateway-checkout" aria-busy={loading || busy}>
    <div className="gateway-amount-banner">
      <span>Số tiền thanh toán</span>
      <strong>{formatVnd(order.total)}</strong>
    </div>
    {loading && <p role="status">Đang tải thông tin thanh toán…</p>}
    {status && status.effectiveState !== 'AWAITING' && <p role="status" className="gateway-status-pill">{paymentMessage(status)}</p>}
    {error && <p role="alert" className="checkout-error">{error}</p>}
    <div className="checkout-action-group">
      <button type="button" className="brew-btn brew-btn-primary" data-checkout-action="gateway-payment" disabled={disabled || loading || busy || !!error || !permitted || (!zero && !acceptingNewPayments)} onClick={() => void pay()}>
        {zero ? 'Xác nhận đơn 0 VND' : status?.canResume ? 'Tiếp tục thanh toán' : status?.effectiveState === 'FAILED' ? 'Thanh toán lại' : 'Thanh toán VNPAY'}
      </button>
      <button type="button" className="brew-btn brew-btn-secondary" disabled={loading || busy || disabled} onClick={() => { setVersion(v => v + 1); notifyToast('Đã làm mới trạng thái thanh toán.', 'info'); }}>
        Làm mới trạng thái
      </button>
      {status && (
        <Link className="brew-btn brew-btn-outline" href={resultPath(status.attemptId)}>
          Xem kết quả thanh toán
        </Link>
      )}
      {(!status ? !recovery : status.canCancel && !status.requiresReview) && !loading && !error && (
        <button type="button" className="brew-btn brew-btn-danger" disabled={disabled || busy} onClick={() => void onCancel()}>
          Hủy đơn hàng
        </button>
      )}
    </div>
  </div>;
}

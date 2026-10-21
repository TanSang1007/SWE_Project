import type { AttemptStatus } from './api/gateway-payments';
export function resultPath(id: string) { return '/payments/vnpay/result?attemptId=' + id; }
export function verifiedCustomerCancellation(a: AttemptStatus) {
  return a.failureReason === 'CUSTOMER_CANCELLED' && a.effectiveState === 'FAILED'
    && a.applicationState === 'APPLIED' && !!a.paymentId && !a.requiresReview && ['PAYMENT_FAILED', 'CANCELLED'].includes(a.orderStatus);
}
export function paymentMessage(a: AttemptStatus) {
  if (verifiedCustomerCancellation(a)) return 'Bạn đã hủy giao dịch VNPAY. Thanh toán không thành công.';
  if (a.requiresReview || a.effectiveState === 'REVIEW') return a.messageCode === 'PAYMENT_RECEIVED_REVIEW'
    ? 'Đã nhận kết quả thanh toán, giao dịch đang được kiểm tra. Vui lòng không thanh toán lại.' : 'Giao dịch đang được kiểm tra. Vui lòng không thanh toán lại.';
  return { AWAITING: 'Đang xác minh kết quả thanh toán.', SUCCEEDED: 'Thanh toán thành công.',
    FAILED: 'Thanh toán không thành công.', UNKNOWN: 'Chưa thể xác định kết quả thanh toán. Vui lòng kiểm tra lại sau; không thanh toán lại.' }[a.effectiveState];
}
// Serial reads,3s ticks for at most60s (including hidden time); no mutation/retry.
export function pollPayment(read: (signal: AbortSignal) => Promise<AttemptStatus>, receive: (a: AttemptStatus) => void,
  failed: (e: unknown) => void, ended: () => void,
  runtime = { now: () => Date.now(), visible: () => document.visibilityState !== 'hidden',
    schedule: (f: () => void, ms: number) => setTimeout(f, ms), cancel: (t: ReturnType<typeof setTimeout>) => clearTimeout(t) }) {
  const controller = new AbortController(), start = runtime.now(); let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = runtime.schedule(() => { stop(); ended(); }, 60000);
  function stop() { controller.abort(); if (timer !== undefined) runtime.cancel(timer); runtime.cancel(deadline); }
  async function tick() {
    if (controller.signal.aborted) return;
    if (runtime.now() - start >= 60000) { stop(); ended(); return; }
    if (runtime.visible()) {
      try {
        const a = await read(controller.signal); if (controller.signal.aborted) return; receive(a);
        if (a.effectiveState !== 'AWAITING' || a.requiresReview) { stop(); return; }
      } catch (e) { if (!controller.signal.aborted) { stop(); failed(e); } return; }
    }
    if (!controller.signal.aborted) timer = runtime.schedule(() => { void tick(); }, 3000);
  }
  void tick(); return stop;
}

'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../lib/auth-store';
import { useCartStore } from '../lib/cart-store';
import { OrderError, orderRequest } from '../lib/api/orders';
import { clearOrderContext, readOrderContext, writeOrderContext, recoveryOrderId, newOrderContext, type OrderContext } from '../lib/order-context';
import { formatVnd } from '../lib/money';
import type { Cart } from '../types/cart';
import type { Order } from '../types/order';
import { paymentRequest } from '../lib/api/payments';
import { clearPaymentContext, readPaymentContext, writePaymentContext, type PaymentContext } from '../lib/payment-context';
import type { PaymentInput } from '../types/payment';
import { checkoutErrorMessage, checkoutStatusMessage, unpaid } from '../lib/checkout-policy';
import { previewOrder, type OrderPreview } from '../lib/api/loyalty-redemption';
import { OrderSummary } from './order-summary';
import { paymentConfiguration, type ProviderMode } from '../lib/api/gateway-payments';
import { PaymentCountdown } from './payment-countdown';
import { GatewayCheckout } from './gateway-checkout';
import { PaymentAdmissionNotice } from './payment-admission-notice';
export { OrderSummary } from './order-summary';
export function OrderCheckout({ cart, disabled, onLock, resumeOrderId }: { cart: Cart | null; disabled: boolean; onLock: (locked: boolean) => void; resumeOrderId?: string }) {
  const token = useAuthStore((s) => s.accessToken); const userId = useAuthStore((s) => s.user?.id);
  const [order, setOrder] = useState<Order | null>(null); const [context, setContext] = useState<OrderContext | null>(null);
  const [paymentContext, setPaymentContext] = useState<PaymentContext | null>(null);
  const [busy, setBusy] = useState(false); const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState(''); const [cartStale, setCartStale] = useState(false);
  const [cartSynced, setCartSynced] = useState(false);
  const [promotion, setPromotion] = useState(''); const [method, setMethod] = useState<PaymentInput['method']>('WALLET');
  const [selectedPoints,setSelectedPoints]=useState('0'); const [quote,setQuote]=useState<OrderPreview|null>(null);
  const [quoteBusy,setQuoteBusy]=useState(false); const [quoteError,setQuoteError]=useState(''); const [quoteAttempt,setQuoteAttempt]=useState(0);
  const [debtBlocked,setDebtBlocked]=useState(false);
  const [provider, setProvider] = useState<{ token: string; mode: ProviderMode; acceptingNewPayments: boolean } | null>(null);
  const [configError, setConfigError] = useState(''); const [configVersion, setConfigVersion] = useState(0);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const mode = provider?.token === token ? provider.mode : null;
  const acceptingNewPayments = provider?.token === token && provider.acceptingNewPayments;
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      setProvider(null); setConfigError('');
      if (!token) return;
      try { const effective = await paymentConfiguration(controller.signal); if (!controller.signal.aborted) setProvider({ token, mode: effective.providerMode, acceptingNewPayments: effective.acceptingNewPayments }); }
      catch { if (!controller.signal.aborted) setConfigError('Chưa tải được cấu hình thanh toán. Vui lòng thử lại; chưa thể gửi yêu cầu thanh toán.'); }
    });
    return () => controller.abort();
  }, [token, configVersion]);
  const validPoints=/^(0|[1-9]\d*)$/.test(selectedPoints)&&Number(selectedPoints)<=2147483647;
  const [previewSubtotal, setPreviewSubtotal] = useState<string | undefined>();
  const [discoveredId, setDiscoveredId] = useState<string>();
  // Synchronous gate prevents two handlers starting before React disables controls.
  const inFlight = useRef(false); const readSequence = useRef(0);
  const mounted = useRef(true);
  const isCurrent = useCallback(() => mounted.current && useAuthStore.getState().accessToken === token, [token]);
  const invalidateRead = useCallback(() => { readSequence.current++; }, []);
  const active = unpaid(order); const waiting = busy || restoring || gatewayBusy;
  const knownId = order?.id ?? paymentContext?.payload.orderId ?? context?.orderId ?? discoveredId;
  const createUncertain = (!!context || !!discoveredId) && !order;
  const locked = waiting || active || createUncertain || !!paymentContext || cartStale;
  useEffect(() => { onLock(locked); }, [locked, onLock]);
  const recover = useCallback(async (id: string) => {
    const sequence = ++readSequence.current;
    const current = await orderRequest('/orders/' + id);
    if (!isCurrent() || sequence !== readSequence.current) return null;
    setOrder(current);
    if (!unpaid(current)) { clearOrderContext(); setContext(null); }
    return current;
  }, [isCurrent]);
  const refreshCart = useCallback(async () => {
    setCartStale(true); setCartSynced(false);
    try {
      const committed = await useCartStore.getState().load();
      if (isCurrent() && committed) { setCartStale(false); setCartSynced(true); }
      else if (isCurrent()) setError('Một lần tải giỏ khác đang thay thế kết quả này. Hãy mở / tải lại đơn hiện tại trước khi đặt đơn mới.');
    }
    catch { if (isCurrent()) setError('Đã đọc trạng thái đơn nhưng chưa tải được giỏ. Hãy mở / tải lại đơn hiện tại trước khi đặt đơn mới.'); }
  }, [isCurrent]);
  useEffect(() => {
    let alive = true;
    mounted.current = true;
    async function restore() {
      await Promise.resolve();
      if (!userId || !alive) return;
      const saved = readOrderContext(userId); const payment = readPaymentContext(userId);
      // Keep original contexts even if current-state GET is unavailable.
      setContext(saved); setPaymentContext(payment); setPreviewSubtotal(saved?.previewSubtotal);
      if (saved?.payload.promotionCode) setPromotion(saved.payload.promotionCode);
      setSelectedPoints(String(saved?.payload.redeemedPoints ?? 0));
      if (payment) setMethod(payment.payload.method);
      const id = recoveryOrderId(saved, payment, resumeOrderId);
      if (resumeOrderId && id === resumeOrderId && !payment && !saved) setDiscoveredId(id);
      try { if (id && await recover(id)) await refreshCart(); }
      catch (e) { if (alive) setError(checkoutErrorMessage(e, 'refresh')); }
      finally { if (alive) setRestoring(false); }
    }
    void restore();
    const discover = (event: Event) => {
      if (inFlight.current) return;
      inFlight.current = true; setBusy(true);
      const id = (event as CustomEvent<string>).detail;
      setDiscoveredId(id);
      void recover(id).catch((e) => { if (alive) setError(checkoutErrorMessage(e, 'refresh')); })
        .finally(() => { inFlight.current = false; if (alive) setBusy(false); });
    };
    window.addEventListener('brewlite-unpaid-order', discover);
    return () => { alive = false; mounted.current = false; invalidateRead(); window.removeEventListener('brewlite-unpaid-order', discover); };
  }, [userId, recover, invalidateRead, refreshCart, resumeOrderId]);
  const quoteInput=useMemo(()=>cart?.items.length ? {items:cart.items.map(i=>({productId:i.productId,size:i.size,qty:i.qty,toppingIds:i.toppings.map(t=>t.id)})),
    ...(promotion.trim()?{promotionCode:promotion.trim().toUpperCase()}:{}),redeemedPoints:Number(selectedPoints)} : null,[cart,promotion,selectedPoints]);
  useEffect(()=>{
    const controller=new AbortController();
    async function load(){
      await Promise.resolve();
      if(active||context||paymentContext||restoring||!token||!quoteInput){setQuote(null);setQuoteBusy(false);return;}
      setQuote(null);setQuoteError('');
      if(!validPoints){setQuoteError('Nhập số điểm nguyên từ 0 đến 2.147.483.647.');setQuoteBusy(false);return;}
      setQuoteBusy(true);
      const timer=setTimeout(()=>{void previewOrder(quoteInput,controller.signal).then(q=>{if(!controller.signal.aborted&&isCurrent())setQuote(q);})
        .catch(e=>{if(!controller.signal.aborted&&isCurrent())setQuoteError(checkoutErrorMessage(e,'create'));})
        .finally(()=>{if(!controller.signal.aborted&&isCurrent())setQuoteBusy(false);});},200);
      controller.signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});
    }
    void load();return()=>controller.abort();
  },[quoteInput,validPoints,active,context,paymentContext,restoring,token,quoteAttempt,isCurrent]);
  async function maximum(){
    if(!quoteInput||waiting||context)return;setQuoteBusy(true);setQuoteError('');
    try{const q=await previewOrder({...quoteInput,redeemedPoints:0});if(isCurrent()){setSelectedPoints(String(q.maxRedeemablePoints));setQuote(q);setQuoteAttempt(v=>v+1);}}
    catch(e){if(isCurrent())setQuoteError(checkoutErrorMessage(e,'create'));}finally{if(isCurrent())setQuoteBusy(false);}
  }
  function begin() { if (inFlight.current || restoring) return false; inFlight.current = true; setBusy(true); setError(''); return true; }
  function finish() { inFlight.current = false; if (isCurrent()) setBusy(false); }
  function save(work: () => void) { try { work(); } catch { throw new OrderError('RETRY_CONTEXT_UNAVAILABLE'); } }
  async function refresh() {
    if (!knownId || !begin()) return;
    try { if (await recover(knownId)) await refreshCart(); }
    catch (e) { if (isCurrent()) setError(checkoutErrorMessage(e, 'refresh')); }
    finally { finish(); }
  }
  async function place() {
    if (!context && mode === 'VNPAY_SANDBOX' && !acceptingNewPayments && quote?.finalTotal !== '0') return;
    if ((!context && (!validPoints || quoteBusy)) || (!context && !cart?.items.length) || !userId || disabled || active || paymentContext || (cartStale && !context) || (discoveredId && !order) || !begin()) return;
    let submitted: OrderContext | undefined;
    let operation: 'create' | 'refresh' = 'create';
    try {
      if (context?.orderId) { operation = 'refresh'; if (await recover(context.orderId)) await refreshCart(); return; }
      let cached = context;
      if (!cached) {
        if (!cart?.items.length) return;
        cached = newOrderContext(userId, { items: cart.items.map((i) => ({
          productId: i.productId, size: i.size, qty: i.qty, toppingIds: i.toppings.map((t) => t.id) })), ...(promotion.trim() ? { promotionCode: promotion.trim().toUpperCase() } : {}), redeemedPoints: Number(selectedPoints) }, cart.subtotal);
      }
      const attempt = cached;
      submitted = attempt;
      save(() => writeOrderContext(attempt)); setContext(attempt); setOrder(null); setDiscoveredId(undefined); setPreviewSubtotal(attempt.previewSubtotal);
      const created = await orderRequest('/orders', 'POST', attempt.payload, attempt.key);
      if (!isCurrent()) return;
      const saved = { ...attempt, orderId: created.id }; setContext(saved);
      try { writeOrderContext(saved); } catch { setError('Đơn đã được tạo nhưng chưa lưu được mã đơn trong tab. Hãy giữ tab này mở và tải lại đơn.'); }
      operation = 'refresh'; if (await recover(created.id)) await refreshCart();
    } catch (e) {
      if (!isCurrent()) return;
      setError(checkoutErrorMessage(e, operation));
      if (e instanceof OrderError && e.existingOrderId && submitted) {
        const saved = { ...submitted, orderId: e.existingOrderId }; setContext(saved);
        try { writeOrderContext(saved); } catch { /* Context remains in memory. */ }
        await recover(e.existingOrderId).catch((err) => setError(checkoutErrorMessage(err, 'refresh')));
      } else if (e instanceof OrderError && ['PAYMENT_ADMISSION_CLOSED', 'VNPAY_MINIMUM_AMOUNT_NOT_MET', 'CONCURRENT_UPDATE', 'OUT_OF_STOCK', 'PRODUCT_UNAVAILABLE', 'INVALID_ITEM_OPTIONS', 'VALIDATION_ERROR', 'PROMOTION_INVALID', 'LOYALTY_INSUFFICIENT_POINTS', 'LOYALTY_REDEMPTION_EXCEEDS_TOTAL', 'LOYALTY_REVERSAL_OUTSTANDING'].includes(e.code)) {
        if (e.code === 'PAYMENT_ADMISSION_CLOSED') setConfigVersion(v => v + 1);
        clearOrderContext(); setContext(null); await refreshCart();
      }
    } finally { finish(); }
  }
  async function cancel() {
    if (!order || !active || paymentContext || disabled || !begin()) return;
    try {
      const updated = await orderRequest('/orders/' + order.id + '/cancel', 'POST');
      if (!isCurrent()) return;
      setSelectedPoints('0');setDebtBlocked(false);
      setOrder(updated); clearOrderContext(); setContext(null); clearPaymentContext(); setPaymentContext(null); await refreshCart();
    } catch (e) { if (isCurrent()) setError(checkoutErrorMessage(e, 'cancel')); }
    finally { finish(); }
  }
  async function pay() {
    if (mode !== 'MOCK' || order?.total === '0') return;
    const id = paymentContext?.payload.orderId ?? order?.id;
    if (!id || !userId || (!active && !paymentContext) || disabled || !begin()) return;
    setCartSynced(false);
    try {
      const attempt = paymentContext ?? { userId, key: crypto.randomUUID(), payload: { orderId: id, method } };
      save(() => writePaymentContext(attempt)); setPaymentContext(attempt);
      await paymentRequest(attempt.payload, attempt.key);
      if (!isCurrent()) return;
      if (!await recover(id)) return; // Historical replay never substitutes for current GET.
      clearPaymentContext(); setPaymentContext(null); clearOrderContext(); setContext(null);
      await refreshCart();
    } catch (e) {
      if (!isCurrent()) return;
      setError(checkoutErrorMessage(e, 'payment'));
      if (e instanceof OrderError && ['OUT_OF_STOCK', 'CONCURRENT_UPDATE', 'ORDER_ALREADY_PAID', 'INVALID_ORDER_STATE', 'VALIDATION_ERROR', 'MISSING_IDEMPOTENCY_KEY', 'ORDER_NOT_FOUND', 'LOYALTY_INSUFFICIENT_POINTS', 'LOYALTY_REVERSAL_OUTSTANDING'].includes(e.code)) {
        setDebtBlocked(e.code==='LOYALTY_REVERSAL_OUTSTANDING');
        clearPaymentContext(); setPaymentContext(null);
        if (await recover(id).catch(() => null)) await refreshCart();
      }
    } finally { finish(); }
  }
  return <section className="order-checkout" aria-labelledby="checkout-heading" aria-busy={waiting}>
    <h2 id="checkout-heading">Đặt đơn</h2>{error && <p role="alert" className="checkout-error">{error}</p>}
    {waiting && <p role="status">{restoring ? 'Đang khôi phục đơn và yêu cầu đã lưu…' : 'Đang xử lý đơn…'}</p>}
    {debtBlocked && active && <p role="alert">Nghĩa vụ thu hồi điểm đang chặn thanh toán. Hủy đơn để giải phóng điểm và bù nghĩa vụ; sau đó có thể đặt đơn mới không dùng điểm.</p>}
    {active && <p role="status">Bạn đang có đơn chưa hoàn tất. Bạn vẫn có thể chỉnh sửa giỏ cho lần đặt tiếp theo.</p>}
    {createUncertain && !waiting && <p role="status">{context ? 'Yêu cầu đặt đơn đã được lưu. Hãy phục hồi yêu cầu này trước khi chỉnh sửa giỏ hoặc tạo đơn mới.' : 'Chưa tải được đơn đang gắn với giỏ. Hãy mở / tải lại đơn hiện tại trước khi chỉnh sửa giỏ.'}</p>}
    {order && <><OrderSummary order={order} /><PaymentCountdown key={order.serverNow} expiresAt={order.expiresAt} serverNow={order.serverNow} verifying={order.status === 'PENDING'} /></>}
    {order && <Link href={`/orders/${order.id}/confirmation`}>Xem lại đơn hàng</Link>}
    {order && !(mode === 'VNPAY_SANDBOX' && active) && <p role={order.status === 'PAYMENT_FAILED' ? 'alert' : 'status'}>{checkoutStatusMessage(order.status)}</p>}
    {order?.status === 'PAID' && cartSynced && <p>Giỏ đã được cập nhật.</p>}
    {order && active && previewSubtotal && previewSubtotal !== order.subtotal && <p role="status">Giá món đã thay đổi so với giỏ trước khi đặt. Hãy kiểm tra và xác nhận tổng đơn mới bên dưới.</p>}
    {!mode && !configError && <p role="status">Đang tải cấu hình thanh toán…</p>}
    {configError && <p role="alert">{configError} <button type="button" onClick={() => setConfigVersion(v => v + 1)}>Tải lại cấu hình thanh toán</button></p>}
    <PaymentAdmissionNotice closed={mode === 'VNPAY_SANDBOX' && !acceptingNewPayments} />
    {mode === 'VNPAY_SANDBOX' && <button type="button" disabled={waiting} onClick={() => setConfigVersion(v => v + 1)}>Cập nhật trạng thái nhận thanh toán</button>}
    {mode && order && active && (mode === 'VNPAY_SANDBOX' || order.total === '0') && !paymentContext && <GatewayCheckout key={order.id + token} order={order} disabled={disabled || busy || restoring}
      acceptingNewPayments={acceptingNewPayments} onBusy={setGatewayBusy} onConfirmed={refresh} onCancel={cancel} />}
    {mode === 'VNPAY_SANDBOX' && paymentContext && <p role="alert">Có yêu cầu Mock đã lưu cần được kiểm tra. Hãy tải lại đơn; không chuyển yêu cầu cũ sang cổng thanh toán.</p>}
    {mode === 'MOCK' && order?.total !== '0' && (active || paymentContext) && <>
      <label htmlFor="checkout-method">Phương thức thanh toán</label><select id="checkout-method" value={method} disabled={waiting || !!paymentContext} onChange={(e) => setMethod(e.target.value as PaymentInput['method'])}>
        <option value="WALLET">Ví</option><option value="CARD">Thẻ</option></select>
      {active && <p id="checkout-payment-note">Xác nhận thanh toán tổng đơn: {order && formatVnd(order.total)}. Thanh toán Ví/Thẻ giả lập; không nhập thông tin thẻ thật.</p>}
      {paymentContext && <p role="status">Kết quả yêu cầu thanh toán đã lưu cần được xác nhận. Thử lại giữ nguyên phương thức và yêu cầu cũ.</p>}
      <button data-checkout-action="payment" aria-describedby={active ? 'checkout-payment-note' : undefined} disabled={waiting || disabled || (!order && !paymentContext)} onClick={() => void pay()}>
        {paymentContext ? 'Thử lại cùng yêu cầu thanh toán' : order?.status === 'PAYMENT_FAILED' ? 'Thử lại thanh toán' : 'Thanh toán'}{active && order ? ' · ' + formatVnd(order.total) : ''}</button>
    </>}
    {knownId && <button data-checkout-action="refresh" disabled={waiting} onClick={() => void refresh()}>Mở / tải lại đơn hiện tại</button>}
    {active && mode === 'MOCK' && order?.total !== '0' && <><button data-checkout-action="cancel" disabled={waiting || disabled || !!paymentContext} onClick={() => void cancel()}>{debtBlocked?'Hủy đơn để giải phóng điểm':'Hủy đơn chưa thanh toán'}</button>
      {paymentContext && <p>Chưa thể hủy khi kết quả thanh toán chưa rõ. Hãy thử lại cùng yêu cầu hoặc tải lại trạng thái đơn.</p>}</>}
    {!active && !paymentContext && <><label htmlFor="checkout-promotion">Mã giảm giá (tùy chọn)</label><input id="checkout-promotion" aria-describedby="checkout-promotion-note" value={promotion} maxLength={32} disabled={waiting || !!context} onChange={(e) => setPromotion(e.target.value)} />
      <p id="checkout-promotion-note">Mã được kiểm tra khi đặt hàng. Kiểm tra mức giảm và tổng đơn được xác nhận trước khi thanh toán.</p>
      <label htmlFor="checkout-points">Điểm tích lũy sử dụng (tùy chọn)</label>
      <input id="checkout-points" type="text" inputMode="numeric" pattern="[0-9]*" aria-describedby="checkout-points-note" value={selectedPoints} disabled={waiting||!!context} onChange={e=>setSelectedPoints(e.target.value)} />
      <p id="checkout-points-note">1 điểm = 100 VND. Mặc định không sử dụng điểm.</p>
      <button type="button" data-checkout-action="maximum" disabled={waiting||quoteBusy||!!context||!cart?.items.length} onClick={()=>void maximum()}>Sử dụng tối đa</button>
      {quoteBusy&&<p role="status">Đang tính giá dự kiến…</p>}
      {quoteError&&<p role="alert">{quoteError} <button type="button" disabled={waiting||quoteBusy} onClick={()=>setQuoteAttempt(v=>v+1)}>Tính lại</button></p>}
      {quote&&<div className="loyalty-quote" aria-live="polite"><p>Giá dự kiến; đơn sẽ được kiểm tra lại khi đặt.</p>
        <p data-checkout-available={quote.availablePoints}>Điểm có thể dùng: {quote.availablePoints} ({formatVnd(String(quote.availablePoints*100))})</p>
        {quote.outstandingReversalPoints!=='0'&&<p>Nghĩa vụ điểm: {quote.outstandingReversalPoints}. Điểm thưởng mới sẽ bù nghĩa vụ trước.</p>}
        <dl className="order-totals"><div><dt>Tạm tính</dt><dd>{formatVnd(quote.itemSubtotal)}</dd></div><div><dt>Giảm từ mã{quote.promotionCode ? ' (' + quote.promotionCode + ')' : ''}</dt><dd>{formatVnd(quote.promotionDiscount)}</dd></div>
          <div><dt>Giảm từ điểm</dt><dd>{formatVnd(quote.loyaltyDiscount)}</dd></div><div><dt>Tổng dự kiến</dt><dd data-preview-total={quote.finalTotal}>{formatVnd(quote.finalTotal)}</dd></div>
          <div><dt>Điểm thưởng dự kiến</dt><dd>{quote.earnedPoints}</dd></div></dl></div>}
      <button data-checkout-action="create" disabled={waiting || disabled || (!context && (quoteBusy||!validPoints)) || (!context && !cart?.items.length) || (cartStale && !context) || (!!discoveredId && !order) || (!context && mode === 'VNPAY_SANDBOX' && !acceptingNewPayments && quote?.finalTotal !== '0')} onClick={() => void place()}>{context ? 'Thử lại cùng yêu cầu' : 'Đặt hàng'}</button>
      {!cart?.items.length && !context && <p>Thêm ít nhất một món vào giỏ để đặt đơn.</p>}</>}
  </section>;
}

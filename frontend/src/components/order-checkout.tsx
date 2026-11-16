'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../lib/auth-store';
import { useCartStore } from '../lib/cart-store';
import { OrderError, orderRequest } from '../lib/api/orders';
import { clearOrderContext, readOrderContext, writeOrderContext, recoveryOrderId, newOrderContext, type OrderContext } from '../lib/order-context';
import { clearGatewayContext } from '../lib/gateway-context';
import { formatVnd } from '../lib/money';
import type { Cart } from '../types/cart';
import type { Order } from '../types/order';
import { checkoutErrorMessage, unpaid } from '../lib/checkout-policy';
import { previewOrder, type OrderPreview } from '../lib/api/loyalty-redemption';
import { OrderSummary } from './order-summary';
import { paymentConfiguration, type ProviderMode } from '../lib/api/gateway-payments';
import { GatewayCheckout } from './gateway-checkout';
import { PaymentAdmissionNotice } from './payment-admission-notice';
import { notifyToast } from '../lib/notification-store';
export { OrderSummary } from './order-summary';
export function OrderCheckout({ cart, disabled, onLock, resumeOrderId }: { cart: Cart | null; disabled: boolean; onLock: (locked: boolean) => void; resumeOrderId?: string }) {
  const token = useAuthStore((s) => s.accessToken); const userId = useAuthStore((s) => s.user?.id);
  const [order, setOrder] = useState<Order | null>(null); const [context, setContext] = useState<OrderContext | null>(null);
  const [busy, setBusy] = useState(false); const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState(''); const [cartStale, setCartStale] = useState(false);
  const [cartSynced, setCartSynced] = useState(false);
  const [promotion, setPromotion] = useState('');
  const [selectedPoints,setSelectedPoints]=useState('0'); const [quote,setQuote]=useState<OrderPreview|null>(null);
  const [quoteBusy,setQuoteBusy]=useState(false); const [quoteError,setQuoteError]=useState(''); const [quoteAttempt,setQuoteAttempt]=useState(0);
  const [debtBlocked,setDebtBlocked]=useState(false);
  const [provider, setProvider] = useState<{ token: string; mode: ProviderMode; acceptingNewPayments: boolean } | null>(null);
  const [configError, setConfigError] = useState(''); const [configVersion, setConfigVersion] = useState(0);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [autoStartOrderId, setAutoStartOrderId] = useState<string>();
  const mode = provider?.token === token ? provider.mode : null;
  const acceptingNewPayments = provider?.token === token && provider.acceptingNewPayments;
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      setProvider(null); setConfigError('');
      if (!token) return;
      try { const effective = await paymentConfiguration(controller.signal); if (!controller.signal.aborted) setProvider({ token, mode: effective.providerMode, acceptingNewPayments: effective.acceptingNewPayments }); }
      catch { if (!controller.signal.aborted) setConfigError('Chưa tải được cấu hình thanh toán.'); }
    });
    return () => controller.abort();
  }, [token, configVersion]);
  const validPoints=/^(0|[1-9]\d*)$/.test(selectedPoints)&&Number(selectedPoints)<=2147483647;
  const [previewSubtotal, setPreviewSubtotal] = useState<string | undefined>();
  const [discoveredId, setDiscoveredId] = useState<string>();
  const inFlight = useRef(false); const readSequence = useRef(0);
  const mounted = useRef(true);
  const isCurrent = useCallback(() => mounted.current && useAuthStore.getState().accessToken === token, [token]);
  const invalidateRead = useCallback(() => { readSequence.current++; }, []);
  const active = unpaid(order); const waiting = busy || restoring || gatewayBusy;
  const knownId = order?.id ?? context?.orderId ?? discoveredId;
  const createUncertain = (!!context || !!discoveredId) && !order;
  const locked = waiting || active || createUncertain || cartStale;
  useEffect(() => { onLock(locked); }, [locked, onLock]);
  const recover = useCallback(async (id: string) => {
    const sequence = ++readSequence.current;
    const current = await orderRequest('/orders/' + id);
    if (!isCurrent() || sequence !== readSequence.current) return null;
    if (current.status === 'CANCELLED') {
      clearOrderContext();
      clearGatewayContext();
      setContext(null);
      setDiscoveredId(undefined);
      setOrder(null);
      return null;
    }
    setOrder(current);
    if (!unpaid(current)) { clearOrderContext(); clearGatewayContext(); setContext(null); }
    return current;
  }, [isCurrent]);
  const refreshCart = useCallback(async () => {
    setCartStale(true); setCartSynced(false);
    try {
      const committed = await useCartStore.getState().load();
      if (isCurrent() && committed) { setCartStale(false); setCartSynced(true); }
      else if (isCurrent()) setError('Chưa đồng bộ được giỏ hàng.');
    }
    catch { if (isCurrent()) setError('Chưa tải được giỏ hàng.'); }
  }, [isCurrent]);
  useEffect(() => {
    let alive = true;
    mounted.current = true;
    async function restore() {
      await Promise.resolve();
      if (!userId || !alive) return;
      const saved = readOrderContext(userId);
      setContext(saved); setPreviewSubtotal(saved?.previewSubtotal);
      if (saved?.payload.promotionCode) setPromotion(saved.payload.promotionCode);
      setSelectedPoints(String(saved?.payload.redeemedPoints ?? 0));
      const id = recoveryOrderId(saved, resumeOrderId);
      if (resumeOrderId && id === resumeOrderId && !saved) setDiscoveredId(id);
      try { if (id) await recover(id); await refreshCart(); }
      catch (e) { if (alive) setError(checkoutErrorMessage(e, 'refresh')); }
      finally { if (alive) setRestoring(false); }
    }
    void restore();
    const discover = (event: Event) => {
      const id = (event as CustomEvent<string | undefined>).detail;
      if (!id) return;
      if (inFlight.current) return;
      inFlight.current = true; setBusy(true);
      setDiscoveredId(id);
      void recover(id).catch((e) => { if (alive) setError(checkoutErrorMessage(e, 'refresh')); })
        .finally(() => { inFlight.current = false; if (alive) setBusy(false); });
    };
    window.addEventListener('brewlite-unpaid-order', discover);
    return () => { alive = false; mounted.current = false; invalidateRead(); window.removeEventListener('brewlite-unpaid-order', discover); };
  }, [userId, recover, invalidateRead, refreshCart, resumeOrderId]);
  const quoteInput=useMemo(()=>cart?.items.length ? {items:cart.items.map(i=>({productId:i.productId,size:i.size,qty:i.qty,toppingIds:i.toppings.map(t=>t.id)})),
    ...(promotion.trim()?{promotionCode:promotion.trim().toUpperCase()}:{}),redeemedPoints:Number(selectedPoints)} : null,[cart,promotion,selectedPoints]);
  const [quotedInput, setQuotedInput] = useState<typeof quoteInput>(null);
  const quoteReady = !!quote && quotedInput === quoteInput && !quoteBusy && !quoteError;
  useEffect(()=>{
    const controller=new AbortController();
    async function load(){
      await Promise.resolve();
      if(active||context||restoring||!token||!quoteInput){setQuote(null);setQuoteBusy(false);return;}
      setQuote(null);setQuoteError('');
      if(!validPoints){setQuoteError('Nhập số điểm nguyên hợp lệ.');setQuoteBusy(false);return;}
      setQuoteBusy(true);
      const timer=setTimeout(()=>{void previewOrder(quoteInput,controller.signal).then(q=>{if(!controller.signal.aborted&&isCurrent()){setQuote(q);setQuotedInput(quoteInput);}})
        .catch(e=>{if(!controller.signal.aborted&&isCurrent())setQuoteError(checkoutErrorMessage(e,'create'));})
        .finally(()=>{if(!controller.signal.aborted&&isCurrent())setQuoteBusy(false);});},200);
      controller.signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});
    }
    void load();return()=>controller.abort();
  },[quoteInput,validPoints,active,context,restoring,token,quoteAttempt,isCurrent]);
  async function maximum(){
    if(!quoteInput||waiting||context||!begin())return;setQuoteBusy(true);setQuoteError('');setQuote(null);setQuotedInput(null);
    try{const q=await previewOrder({...quoteInput,redeemedPoints:0});if(isCurrent()){setSelectedPoints(String(q.maxRedeemablePoints));setQuoteAttempt(v=>v+1);notifyToast(`Đã áp dụng tối đa ${q.maxRedeemablePoints} điểm.`, 'info');}}
    catch(e){if(isCurrent()){const msg=checkoutErrorMessage(e,'create');setQuoteError(msg);notifyToast(msg,'error');}}finally{if(isCurrent())setQuoteBusy(false);finish();}
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
    if ((!context && (!validPoints || !quoteReady)) || (!context && !cart?.items.length) || !userId || disabled || active || (cartStale && !context) || (discoveredId && !order) || !begin()) return;
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
      try { writeOrderContext(saved); } catch { /* ignore storage warning */ }
      setAutoStartOrderId(created.id);
      notifyToast(`Đã tạo đơn hàng ${created.customerOrderCode}. Đang chuyển sang VNPAY…`, 'success');
      operation = 'refresh'; if (await recover(created.id)) await refreshCart();
    } catch (e) {
      if (!isCurrent()) return;
      const msg = checkoutErrorMessage(e, operation);
      setError(msg);
      notifyToast(msg, 'error');
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
    if (!order || !active || disabled || !begin()) return;
    try {
      const cancelledCode = order.customerOrderCode;
      await orderRequest('/orders/' + order.id + '/cancel', 'POST');
      if (!isCurrent()) return;
      setSelectedPoints('0'); setDebtBlocked(false);
      setOrder(null);
      setDiscoveredId(undefined);
      clearOrderContext();
      clearGatewayContext();
      setContext(null);
      window.dispatchEvent(new CustomEvent('brewlite-order-state-changed'));
      await refreshCart();
      notifyToast(`Đã hủy đơn hàng ${cancelledCode}.`, 'info', 'Bạn có thể tạo đơn hàng mới ngay bây giờ.');
    } catch (e) {
      if (isCurrent()) {
        const msg = checkoutErrorMessage(e, 'cancel');
        setError(msg);
        notifyToast(msg, 'error');
      }
    }
    finally { finish(); }
  }
  return <section className="order-checkout" aria-labelledby="checkout-heading" aria-busy={waiting}>
    <div className="checkout-card-header">
      <h2 id="checkout-heading">{order && active ? 'Xác nhận & Thanh toán' : 'Chi tiết đơn hàng & Thanh toán'}</h2>
      {order && <Link className="brew-btn brew-btn-outline" href={`/orders/${order.id}/confirmation`}>Chi tiết đơn</Link>}
    </div>
    {error && <p role="alert" className="checkout-error">{error}</p>}
    {waiting && <p role="status">{restoring ? 'Đang tải thông tin đơn…' : 'Đang xử lý…'}</p>}
    {debtBlocked && active && <p role="alert">Tài khoản đang có nghĩa vụ điểm cần thu hồi.</p>}
    {createUncertain && !waiting && <p role="status">Đang đồng bộ yêu cầu đặt đơn.</p>}
    {order && <OrderSummary order={order} showStatus={!active} />}
    {!order && cart && cart.items.length > 0 && (
      <section className="order-summary" aria-labelledby="checkout-cart-items-heading">
        <h3 id="checkout-cart-items-heading">Chi tiết đơn hàng ({cart.totalQuantity} ly)</h3>
        <ul>
          {cart.items.map((i) => (
            <li key={i.id}>
              <strong>{i.productName}</strong>
              <p>Size {i.size} · {i.qty} ly</p>
              <p>Topping: {i.toppings.map((t) => t.name + ' (' + formatVnd(t.price) + ')').join(', ') || 'Không topping'}</p>
              <p>Đơn giá: {formatVnd(i.unitPrice)} / ly · Thành tiền: {formatVnd(i.lineTotal)}</p>
            </li>
          ))}
        </ul>
      </section>
    )}
    {order?.status === 'PAID' && cartSynced && <p role="status" className="form-success">Đơn hàng đã thanh toán thành công.</p>}
    {order && active && previewSubtotal && previewSubtotal !== order.subtotal && <p role="status">Tổng tiền đã được cập nhật theo đơn hiện tại.</p>}
    {!mode && !configError && <p role="status">Đang tải cấu hình thanh toán…</p>}
    {configError && <p role="alert">{configError} <button type="button" className="brew-btn brew-btn-secondary" onClick={() => setConfigVersion(v => v + 1)}>Tải lại cấu hình</button></p>}
    <PaymentAdmissionNotice closed={mode === 'VNPAY_SANDBOX' && !acceptingNewPayments} />
    {mode && order && active && <GatewayCheckout key={order.id + token} order={order} disabled={disabled || busy || restoring}
      acceptingNewPayments={acceptingNewPayments} autoStart={autoStartOrderId === order.id} onAutoStartHandled={() => setAutoStartOrderId(undefined)}
      onBusy={setGatewayBusy} onConfirmed={refresh} onCancel={cancel} />}
    {!active && (
      <div className="checkout-form-grid">
        <div className="checkout-field-row">
          <label htmlFor="checkout-promotion">Mã giảm giá (tùy chọn)</label>
          <input id="checkout-promotion" placeholder="Nhập mã ưu đãi..." value={promotion} maxLength={32} disabled={waiting || !!context} onChange={(e) => setPromotion(e.target.value)} />
        </div>
        <div className="checkout-field-row">
          <label htmlFor="checkout-points">Điểm tích lũy sử dụng (1 điểm = 100đ)</label>
          <div className="checkout-points-inline">
            <input id="checkout-points" type="text" inputMode="numeric" pattern="[0-9]*" value={selectedPoints} disabled={waiting||!!context} onChange={e=>setSelectedPoints(e.target.value)} />
            <button type="button" className="brew-btn brew-btn-secondary" data-checkout-action="maximum" disabled={waiting||quoteBusy||!!context||!cart?.items.length} onClick={()=>void maximum()}>Dùng tối đa</button>
          </div>
        </div>
        {quoteBusy&&<p role="status">Đang tính giá dự kiến…</p>}
        {quoteError&&<p role="alert" className="checkout-error">{quoteError} <button type="button" className="brew-btn brew-btn-secondary" disabled={waiting||quoteBusy} onClick={()=>setQuoteAttempt(v=>v+1)}>Tính lại</button></p>}
        {quote&&<div className="loyalty-quote" aria-live="polite">
          <p data-checkout-available={quote.availablePoints}>Điểm khả dụng: <strong>{quote.availablePoints}</strong> ({formatVnd(String(quote.availablePoints*100))})</p>
          {quote.outstandingReversalPoints!=='0'&&<p>Nghĩa vụ điểm: {quote.outstandingReversalPoints}</p>}
          <dl className="order-totals"><div><dt>Tạm tính</dt><dd>{formatVnd(quote.itemSubtotal)}</dd></div><div><dt>Giảm từ mã{quote.promotionCode ? ' (' + quote.promotionCode + ')' : ''}</dt><dd>{formatVnd(quote.promotionDiscount)}</dd></div>
            <div><dt>Giảm từ điểm</dt><dd>{formatVnd(quote.loyaltyDiscount)}</dd></div><div><dt>Tổng thanh toán</dt><dd data-preview-total={quote.finalTotal}>{formatVnd(quote.finalTotal)}</dd></div>
            <div><dt>Điểm thưởng dự kiến</dt><dd>{quote.earnedPoints}</dd></div></dl></div>}
        <div className="checkout-action-group">
          <button className="brew-btn brew-btn-primary" data-checkout-action="create" disabled={waiting || disabled || (!context && (!quoteReady||!validPoints)) || (!context && !cart?.items.length) || (cartStale && !context) || (!!discoveredId && !order) || (!context && mode === 'VNPAY_SANDBOX' && !acceptingNewPayments && quote?.finalTotal !== '0')} onClick={() => void place()}>
            {context ? 'Tiếp tục thanh toán' : 'Thanh toán'}
          </button>
          {knownId && (
            <button type="button" className="brew-btn brew-btn-secondary" data-checkout-action="refresh" disabled={waiting} onClick={() => void refresh()}>
              Tải lại đơn
            </button>
          )}
        </div>
        {!cart?.items.length && !context && <p>Giỏ hàng đang trống. Vui lòng chọn món trước khi đặt đơn.</p>}
      </div>
    )}
  </section>;
}

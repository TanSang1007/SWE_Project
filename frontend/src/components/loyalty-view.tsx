'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../lib/auth-store';
import { getLoyaltyBalance, getLoyaltyHistory, type LoyaltyBalance, type LoyaltyEntry } from '../lib/api/loyalty-redemption';
import { OrderError } from '../lib/api/orders';
export type LoyaltyState = { status: 'loading' } | { status: 'ready'; points: number; balance?: LoyaltyBalance } | { status: 'error' };
export type HistoryState = { items: LoyaltyEntry[]; cursor: string|null; loading: boolean; error: boolean };

export function LoyaltyView() {
  const token = useAuthStore((s) => s.accessToken);
  return <section className="loyalty-page"><p className="eyebrow">BrewLite</p><h1>Điểm tích lũy</h1>
    {token ? <LoyaltySession key={token} /> : <div className="state-panel"><p>Đăng nhập để xem điểm tích lũy của bạn.</p>
      <Link className="button" href="/login?returnTo=/loyalty">Đăng nhập</Link></div>}
  </section>;
}
function LoyaltySession() {
  const [state, setState] = useState<LoyaltyState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [history,setHistory]=useState<HistoryState>({items:[],cursor:null,loading:true,error:false});
  const mounted=useRef(true);const generation=useRef(0);const loadingMore=useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    mounted.current=true;
    void getLoyaltyBalance(controller.signal).then((balance) => {
      if (!controller.signal.aborted) setState({ status: 'ready', points:balance.loyaltyPoints, balance });
    }).catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }); });
    void getLoyaltyHistory(undefined,controller.signal).then(page=>{if(!controller.signal.aborted)setHistory({items:page.items,cursor:page.nextCursor,loading:false,error:false});})
      .catch(()=>{if(!controller.signal.aborted)setHistory({items:[],cursor:null,loading:false,error:true});});
    return () => {mounted.current=false;controller.abort();};
  }, [attempt]);
  function retry() {generation.current++;setState({status:'loading'});setHistory({items:[],cursor:null,loading:true,error:false});setAttempt(value=>value+1);}
  async function more(){if(!history.cursor||loadingMore.current)return;loadingMore.current=true;const current=generation.current;setHistory(h=>({...h,loading:true,error:false}));
    try{const page=await getLoyaltyHistory(history.cursor);if(mounted.current&&current===generation.current)setHistory(h=>({items:[...h.items,...page.items],cursor:page.nextCursor,loading:false,error:false}));}
    catch(e){if(mounted.current&&current===generation.current){if(e instanceof OrderError&&e.code==='VALIDATION_ERROR')retry();else setHistory(h=>({...h,loading:false,error:true}));}}finally{loadingMore.current=false;}}
  return <><LoyaltyContent state={state} retry={retry} /><LoyaltyHistoryContent state={history} more={()=>void more()} retry={retry}/></>;
}
export function LoyaltyContent({ state, retry }: { state: LoyaltyState; retry: () => void }) {
  return <div className="state-panel loyalty-panel" aria-busy={state.status === 'loading'}>
    {state.status === 'loading' && <div role="status" aria-live="polite"><div className="loading-mark" aria-hidden="true" /><p>Đang tải điểm tích lũy…</p></div>}
    {state.status === 'error' && <div role="alert"><h2>Chưa tải được điểm tích lũy</h2><p>Kết nối đang gián đoạn. Bạn thử lại sau một chút nhé.</p></div>}
    {state.status === 'ready' && <div role="status" aria-live="polite"><h2>Số điểm hiện tại</h2>
      <p className="loyalty-balance"><strong data-loyalty-points={state.points}>{state.points.toLocaleString('vi-VN')}</strong> điểm</p>
      <p>{state.points === 0 ? 'Bạn chưa có điểm tích lũy. Điểm sẽ được cộng khi thanh toán thành công.' : 'Điểm đã được ghi nhận từ các đơn thanh toán thành công của bạn.'}</p></div>}
    {state.status==='ready'&&<><p>1 điểm = 100 VND, sử dụng tại bước đặt đơn.</p>
      {!!state.balance?.reservedPoints&&<p data-loyalty-reserved={state.balance.reservedPoints}>Điểm đang giữ cho đơn: {state.balance.reservedPoints}</p>}
      {state.balance&&state.balance.outstandingReversalPoints!=='0'&&<p data-loyalty-debt={state.balance.outstandingReversalPoints}>Nghĩa vụ thu hồi điểm: {state.balance.outstandingReversalPoints}. Điểm thưởng, giải phóng hoặc hoàn lại sẽ bù nghĩa vụ trước khi trở thành điểm có thể dùng.</p>}
      <Link href="/orders">Xem đơn hàng</Link></>}
    <button type="button" className="button" disabled={state.status === 'loading'} onClick={retry}>
      {state.status === 'error' ? 'Thử lại' : 'Tải lại điểm'}
    </button>
  </div>;
}
const labels={OPENING:'Số dư đầu kỳ',EARN:'Điểm thưởng',RESERVE:'Giữ điểm',SETTLE:'Đã dùng',RELEASE:'Giải phóng điểm',REFUND:'Hoàn điểm',REVERSE:'Thu hồi điểm'};
const change=(n:number|string)=>{const v=BigInt(n);return (v>0n?'+':'')+v.toLocaleString('vi-VN');};
export function LoyaltyHistoryContent({state,more,retry}:{state:HistoryState;more:()=>void;retry:()=>void}){
  return <section className="state-panel loyalty-history" aria-labelledby="loyalty-history-heading" aria-busy={state.loading}>
    <h2 id="loyalty-history-heading">Lịch sử điểm tích lũy</h2><p>Lịch sử từ thời điểm nâng cấp tính năng. Số dư đầu kỳ không phải một lần cộng điểm mới.</p>
    {!state.items.length&&!state.loading&&!state.error&&<p>Chưa có giao dịch điểm.</p>}
    <ol>{state.items.map((e,i)=><li key={`${e.orderId??'opening'}:${e.kind}:${e.createdAt}:${i}`} data-loyalty-kind={e.kind}>
      <strong>{labels[e.kind]} · {e.points.toLocaleString('vi-VN')} điểm</strong><p>Điểm có thể dùng: {change(e.availableChange)}</p>
      {e.reservedChange!==0&&<p>Điểm đang giữ: {change(e.reservedChange)}</p>}
      {e.debtOffsetPoints!=='0'&&<p>Bù nghĩa vụ điểm: {e.debtOffsetPoints}</p>}
      {e.debtCreatedPoints!=='0'&&<p>Phát sinh nghĩa vụ: {e.debtCreatedPoints}</p>}
      <p><time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleString('vi-VN')}</time>{e.orderId&&<> · <Link href={`/orders/${e.orderId}`}>{e.orderCode}</Link></>}</p>
    </li>)}</ol>
    {state.loading&&<p role="status">Đang tải lịch sử điểm…</p>}
    {state.error&&<p role="alert">Chưa tải được lịch sử điểm. Các giao dịch đã tải vẫn được giữ.</p>}
    {state.cursor&&<button type="button" className="button" disabled={state.loading} onClick={more}>{state.error?'Thử lại':'Xem thêm'}</button>}
    {!state.cursor&&state.error&&<button type="button" className="button" disabled={state.loading} onClick={retry}>Thử lại</button>}
  </section>;
}

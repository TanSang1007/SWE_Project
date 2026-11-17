'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getTracking, remainingPaidWindow, trackingError, trackingRequest, type Tracking } from '../lib/api/order-tracking';
import { formatOrderTime, orderStatusLabels } from '../lib/order-display';
import { formatVnd } from '../lib/money';
import type { UserRole } from '../types/auth';

function useElapsed(){
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{const start=performance.now();const timer=setInterval(()=>setElapsed(performance.now()-start),250);return()=>clearInterval(timer);},[]);
  return elapsed;
}
export function PreparationGate({paidAt,serverNow,disabled,act}:{paidAt:string|null;serverNow?:string;disabled:boolean;act:()=>void}){
  const elapsed=useElapsed(),remaining=remainingPaidWindow(paidAt,serverNow,elapsed);
  return <div><p role="status">{remaining===null?'Cần tải lại thời hạn hủy từ máy chủ.':remaining>0?`Chờ hết thời hạn hủy: ${remaining} giây`:'Chờ nhân viên bắt đầu'}</p>
    <button type="button" className="button" data-workflow-target="PREPARING" disabled={disabled||remaining===null||remaining>0} onClick={act}>Bắt đầu pha chế</button></div>;
}
const refundLabels={PENDING:'Đang xử lý hoàn tiền',SUCCEEDED:'Hoàn tiền thành công',FAILED:'Hoàn tiền thất bại'};
const roleLabels:Record<string,string>={SYSTEM:'Hệ thống',CUSTOMER:'Khách hàng',STAFF:'Nhân viên',ADMIN:'Admin'};
const eventLabels:Record<string,string>={...orderStatusLabels,OPEN:'Đã gửi hỗ trợ',APPROVED:'Đã phê duyệt',REJECTED:'Đã từ chối',SUCCEEDED:'Hoàn tiền thành công',FAILED:'Hoàn tiền thất bại'};
// O01: dùng ở checkout đã trả tiền, chi tiết đơn, kết quả VNPAY và màn hình operator.
// Poll 5s/focus chỉ đọc. Mutation không tự retry khi mất phản hồi; đọc lại trước
// khi cho xử lý tiếp. Role chỉ chọn UI; backend vẫn xác thực quyền/owner/thời hạn.
export function OrderTracking({id,role,onChanged,allowUnpaidCancel=true}:{id:string;role:UserRole;onChanged?:()=>void;allowUnpaidCancel?:boolean}){
  const [data,setData]=useState<Tracking|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirmCancel,setConfirmCancel]=useState(false);
  const gate=useRef(false),supportIntent=useRef<{reason:string;key:string}|null>(null);
  useEffect(()=>{
    const controller=new AbortController();let pending=false;
    async function load(){if(pending)return;pending=true;try{const result=await getTracking(id,controller.signal);if(!controller.signal.aborted){setData(result);setError('');}}catch(e){if(!controller.signal.aborted)setError(trackingError(e));}finally{pending=false;}}
    void load();const timer=setInterval(()=>void load(),5000);const focus=()=>void load();window.addEventListener('focus',focus);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);};
  },[id,revision]);
  async function mutate(path:string,body:object,key?:string){
    if(gate.current||error)return;gate.current=true;setBusy(true);setMessage('');
    let committed=false;
    try{await trackingRequest(path,body,key);committed=true;const fresh=await getTracking(id);setData(fresh);setError('');setConfirmCancel(false);setMessage('Máy chủ đã xác nhận thao tác. Đã đọc lại trạng thái.');onChanged?.();}
    catch(e){setMessage(committed?'Máy chủ đã xác nhận thao tác. Cần tải lại tiến độ, không gửi lại thao tác.':trackingError(e));setError('Cần đọc lại tiến độ trước khi xử lý tiếp.');setRevision(v=>v+1);}finally{gate.current=false;setBusy(false);}
  }
  function support(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const reason=String(new FormData(e.currentTarget).get('reason')??'').trim();if(!reason)return;
    if(supportIntent.current?.reason!==reason)supportIntent.current={reason,key:crypto.randomUUID()};
    void mutate(`/orders/${id}/support-requests`,{reason},supportIntent.current.key);
  }
  function review(e:FormEvent<HTMLFormElement>,request:{id:string;version:number}){
    e.preventDefault();const form=new FormData(e.currentTarget),action=(e.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
    if(action!=='APPROVE'&&action!=='REJECT')return;
    void mutate(`/admin/orders/${id}/support-requests/${request.id}/review`,{expectedVersion:request.version,action,note:String(form.get('note')??'').trim()});
  }
  function refund(e:FormEvent<HTMLFormElement>,action:'SUCCEEDED'|'FAILED'){
    e.preventDefault();if(!data?.refund)return;const form=new FormData(e.currentTarget);
    void mutate(`/admin/orders/${id}/refund`,{expectedVersion:data.refund.version,action,...(action==='SUCCEEDED'?{transactionReference:String(form.get('transaction')??'').trim(),evidenceReference:String(form.get('evidence')??'').trim()}:{note:String(form.get('note')??'').trim()})});
  }
  return <section id="order-tracking" className="order-history-card order-tracking" aria-label="Theo dõi đơn hàng"><h2>Theo dõi đơn hàng</h2>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
    {!data&&!error&&<p>Đang tải tiến độ đơn hàng…</p>}
    {data&&<><TrackingPhase key={data.serverNow} data={data} customer={role==='CUSTOMER'} allowUnpaidCancel={allowUnpaidCancel} disabled={busy||!!error} confirm={confirmCancel} setConfirm={setConfirmCancel} cancel={()=>void mutate(`/orders/${id}/cancel`,{})}/>
      <h3>Hoàn tiền</h3><p data-refund-status={data.refund?.status??'NOT_REQUESTED'}>{data.refund?refundLabels[data.refund.status]:'Chưa yêu cầu hoàn tiền'}</p>
      {data.refund&&<><p>Số tiền: {formatVnd(data.refund.amount)}</p>{data.refund.failureReason&&<p>{data.refund.failureReason}</p>}
        {data.refund.processedAt&&<p>Cập nhật: {formatOrderTime(data.refund.processedAt)}</p>}
        {role==='ADMIN'&&data.refund.status!=='SUCCEEDED'&&<fieldset disabled={busy||!!error} className="ingredient-form"><legend>Xử lý hoàn tiền</legend>
          {!data.refund.approved&&data.refund.status==='PENDING'&&<button className="button" type="button" onClick={()=>void mutate(`/admin/orders/${id}/refund`,{action:'APPROVE',expectedVersion:data.refund!.version})}>Phê duyệt hoàn tiền</button>}
          {data.refund.approved&&data.refund.status==='PENDING'&&<><form onSubmit={e=>refund(e,'SUCCEEDED')}>
            <label>Mã giao dịch hoàn tiền<input name="transaction" maxLength={128} required/></label><label>Bằng chứng hoặc tham chiếu đối soát<textarea name="evidence" maxLength={500} required/></label>
            <label><input type="checkbox" required/> Tôi đã kiểm tra xác nhận giao dịch hoàn tiền thực tế.</label><button className="button" type="submit">Xác nhận đã hoàn tiền</button></form>
            <form onSubmit={e=>refund(e,'FAILED')}><label>Lý do hoàn tiền thất bại<textarea name="note" maxLength={500} required/></label><button className="button" type="submit">Ghi nhận hoàn tiền thất bại</button></form></>}
          {data.refund.status==='FAILED'&&<button className="button" type="button" onClick={()=>void mutate(`/admin/orders/${id}/refund`,{action:'RETRY',expectedVersion:data.refund!.version})}>Mở lại xử lý hoàn tiền</button>}
        </fieldset>}
        {role==='ADMIN'&&data.refund.status==='SUCCEEDED'&&<p>Mã giao dịch: {data.refund.transactionReference} · Bằng chứng: {data.refund.evidenceReference}</p>}
      </>}
      {data.cancelUntil&&<form onSubmit={support} className="ingredient-form"><fieldset disabled={busy||!!error}><legend>Yêu cầu hỗ trợ ngoại lệ</legend>
        <label>Lý do cần hỗ trợ<textarea name="reason" maxLength={500} required placeholder="Mô tả sự cố để nhân viên và Admin xử lý"/></label><button className="button" type="submit">Gửi yêu cầu hỗ trợ</button></fieldset></form>}
      {data.supportRequests.map(s=><article key={s.id} className="order-history-card"><h3>Yêu cầu hỗ trợ</h3><p>{s.reason}</p><p>{eventLabels[s.status]}</p>{s.reviewNote&&<p>Phản hồi: {s.reviewNote}</p>}
        {role==='ADMIN'&&s.status==='OPEN'&&<form onSubmit={e=>review(e,s)} className="ingredient-form"><fieldset disabled={busy||!!error}><legend>Admin xử lý yêu cầu</legend>
          <label>Lý do xử lý<textarea name="note" maxLength={500} required/></label><button className="button" type="submit" value="APPROVE">Duyệt xử lý</button> <button className="button" type="submit" value="REJECT">Từ chối</button></fieldset></form>}</article>)}
      <h3>Lịch sử cập nhật</h3>{data.events.length?<ol>{data.events.map(e=><li key={e.id}><time dateTime={e.at}>{formatOrderTime(e.at)}</time> · {roleLabels[e.actorRole]} · {e.kind==='REFUND'&&e.status==='PENDING'?'Đã tạo yêu cầu hoàn tiền':eventLabels[e.status]??e.status}{e.note&&<p>{e.note}</p>}</li>)}</ol>:<p>Chưa có lịch sử cập nhật được ghi nhận cho đơn này.</p>}
    </>}
    <button className="button" type="button" disabled={busy} onClick={()=>setRevision(v=>v+1)}>Tải lại tiến độ</button>
  </section>;
}
export function TrackingPhase({data,customer,disabled,cancel,confirm,setConfirm,allowUnpaidCancel=true}:{data:Tracking;customer:boolean;disabled:boolean;cancel:()=>void;confirm:boolean;setConfirm:(value:boolean)=>void;allowUnpaidCancel?:boolean}){
  const elapsed=useElapsed();
  const remaining=data.cancelUntil?Math.max(0,Math.ceil((Date.parse(data.cancelUntil)-Date.parse(data.serverNow)-elapsed)/1000)):0;
  const allowed=customer&&(allowUnpaidCancel&&['PENDING','PAYMENT_FAILED'].includes(data.status)||data.status==='PAID'&&data.canCancelPaid&&remaining>0);
  const paidCancellation=customer&&['PAID','PREPARING','READY','COMPLETED'].includes(data.status);
  const blockedReason=!allowed&&paidCancellation?(data.status==='PAID'?(data.cancelUntil===null?'Chưa xác định được thời hạn hủy từ máy chủ. Hãy tải lại tiến độ trước khi hủy.':'Đã hết thời hạn hủy 120 giây sau thanh toán. Bạn có thể gửi yêu cầu hỗ trợ bên dưới.'):'Đơn đã bắt đầu được xử lý nên không thể tự hủy. Bạn có thể gửi yêu cầu hỗ trợ bên dưới.'):null;
  return <div><p role="status" data-tracking-phase={data.status==='PAID'?(remaining>0?'CANCEL_WINDOW':'WAITING_STAFF'):data.status}>
    {data.status==='PAID'?(remaining>0?`Chờ pha chế — có thể hủy trong ${remaining} giây`:'Chờ nhân viên bắt đầu'):orderStatusLabels[data.status as keyof typeof orderStatusLabels]}</p>
    {(allowed||paidCancellation)&&(!confirm||!allowed)&&<button className="button" type="button" data-paid-cancel={paidCancellation||undefined} disabled={disabled||!allowed} aria-describedby={blockedReason?'paid-cancel-reason':undefined} onClick={()=>setConfirm(true)}>Hủy đơn hàng</button>}
    {blockedReason&&<p id="paid-cancel-reason">{blockedReason}</p>}
    {confirm&&allowed&&<fieldset disabled={disabled}><legend>Xác nhận hủy đơn</legend><p>Hủy đơn sẽ giải phóng phần nguyên liệu chưa dùng. Nếu đã thu tiền, hệ thống tạo yêu cầu hoàn tiền và theo dõi riêng.</p>
      <button className="button" type="button" onClick={cancel}>Xác nhận hủy đơn hàng</button> <button className="button" type="button" onClick={()=>setConfirm(false)}>Giữ đơn hàng</button></fieldset>}
  </div>;
}

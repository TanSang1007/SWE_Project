'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getTracking, remainingPaidWindow, trackingError, trackingRequest, type Tracking } from '../lib/api/order-tracking';
import { formatOrderTime, orderStatusLabels } from '../lib/order-display';
import { formatVnd } from '../lib/money';
import { notifyCenterPopup } from '../lib/notification-store';
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
const trackingSteps = [
  { key: 'PAID', label: 'Đã thanh toán' },
  { key: 'PREPARING', label: 'Đang pha chế' },
  { key: 'READY', label: 'Sẵn sàng nhận tại quầy' },
  { key: 'COMPLETED', label: 'Hoàn thành' },
] as const;

// O01: dùng ở checkout đã trả tiền, chi tiết đơn, kết quả VNPAY và màn hình operator.
// Poll 5s/focus chỉ đọc. Mutation không tự retry khi mất phản hồi; đọc lại trước
// khi cho xử lý tiếp. Role chỉ chọn UI; backend vẫn xác thực quyền/owner/thời hạn.
export function OrderTracking({id,role,onChanged,allowUnpaidCancel=true}:{id:string;role:UserRole;onChanged?:()=>void;allowUnpaidCancel?:boolean}){
  const [data,setData]=useState<Tracking|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[confirmCancel,setConfirmCancel]=useState(false);
  const gate=useRef(false),supportIntent=useRef<{reason:string;key:string}|null>(null);
  const readyNotifiedRef=useRef<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();let pending=false;
    async function load(){if(pending)return;pending=true;try{const result=await getTracking(id,controller.signal);if(!controller.signal.aborted){setData(result);setError('');}}catch(e){if(!controller.signal.aborted)setError(trackingError(e));}finally{pending=false;}}
    void load();const timer=setInterval(()=>void load(),5000);const focus=()=>void load();window.addEventListener('focus',focus);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);};
  },[id,revision]);
  useEffect(()=>{
    if(role!=='CUSTOMER'||!data||data.status!=='READY')return;
    const storageKey=`brewlite-ready-notified-${data.orderId}`;
    if(readyNotifiedRef.current===data.orderId)return;
    try{
      if(typeof window!=='undefined'&&window.sessionStorage.getItem(storageKey)==='1'){
        readyNotifiedRef.current=data.orderId;
        return;
      }
      if(typeof window!=='undefined')window.sessionStorage.setItem(storageKey,'1');
    }catch{ /* ignore storage access errors */ }
    readyNotifiedRef.current=data.orderId;
    notifyCenterPopup({
      tone:'success',
      title:'Đồ uống đã sẵn sàng!',
      message:'Nước của bạn đã sẵn sàng, vui lòng đến quầy nhận nước.',
      actions:[{label:'Đã hiểu',variant:'primary'}],
    });
  },[data,role]);
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
  return <section id="order-tracking" className="order-history-card order-tracking" aria-label="Theo dõi đơn hàng">
    <div className="tracking-header">
      <div>
        <p className="tracking-eyebrow">Tiến độ xử lý</p>
        <h2>Theo dõi đơn hàng</h2>
      </div>
      {data && (
        <span className={`tracking-status-badge tracking-status-${data.status.toLowerCase()}`}>
          {orderStatusLabels[data.status as keyof typeof orderStatusLabels] ?? data.status}
        </span>
      )}
    </div>
    {message&&<p role="status" className="tracking-notice tracking-notice-info">{message}</p>}
    {error&&<p role="alert" className="tracking-notice tracking-notice-error">{error}</p>}
    {!data&&!error&&<p className="tracking-loading">Đang tải tiến độ đơn hàng…</p>}
    {data&&<>
      <div className="tracking-panel">
        {trackingSteps.some((s) => s.key === data.status) && (
          <ol className="tracking-stepper" aria-label="Các bước xử lý đơn hàng">
            {trackingSteps.map((step, idx) => {
              const activeStepIndex = trackingSteps.findIndex((s) => s.key === data.status);
              const state = idx < activeStepIndex ? 'done' : idx === activeStepIndex ? 'current' : 'upcoming';
              return (
                <li key={step.key} className={`tracking-step tracking-step-${state}`}>
                  <span className="tracking-step-dot" aria-hidden="true">{idx < activeStepIndex ? '✓' : idx + 1}</span>
                  <span className="tracking-step-label">{step.label}</span>
                </li>
              );
            })}
          </ol>
        )}
        <TrackingPhase key={data.serverNow} data={data} customer={role==='CUSTOMER'} allowUnpaidCancel={allowUnpaidCancel} disabled={busy||!!error} confirm={confirmCancel} setConfirm={setConfirmCancel} cancel={()=>void mutate(`/orders/${id}/cancel`,{})}/>
      </div>

      <div className="tracking-panel">
        <div className="tracking-panel-head">
          <h3>Hoàn tiền</h3>
          <span className={`tracking-pill tracking-pill-${(data.refund?.status ?? 'NONE').toLowerCase()}`} data-refund-status={data.refund?.status??'NOT_REQUESTED'}>
            {data.refund?refundLabels[data.refund.status]:'Chưa yêu cầu hoàn tiền'}
          </span>
        </div>
        {data.refund&&<div className="tracking-refund-meta">
          <p>Số tiền: <strong>{formatVnd(data.refund.amount)}</strong></p>
          {data.refund.failureReason&&<p className="tracking-muted">{data.refund.failureReason}</p>}
          {data.refund.processedAt&&<p className="tracking-muted">Cập nhật: {formatOrderTime(data.refund.processedAt)}</p>}
          {role==='ADMIN'&&data.refund.status!=='SUCCEEDED'&&<fieldset disabled={busy||!!error} className="tracking-fieldset"><legend>Xử lý hoàn tiền</legend>
            {!data.refund.approved&&data.refund.status==='PENDING'&&<button className="brew-btn brew-btn-primary" type="button" onClick={()=>void mutate(`/admin/orders/${id}/refund`,{action:'APPROVE',expectedVersion:data.refund!.version})}>Phê duyệt hoàn tiền</button>}
            {data.refund.approved&&data.refund.status==='PENDING'&&<div className="tracking-admin-forms"><form className="tracking-form" onSubmit={e=>refund(e,'SUCCEEDED')}>
              <label>Mã giao dịch hoàn tiền<input name="transaction" maxLength={128} required/></label>
              <label>Bằng chứng hoặc tham chiếu đối soát<textarea name="evidence" maxLength={500} required rows={3}/></label>
              <label className="tracking-checkbox"><input type="checkbox" required/> Tôi đã kiểm tra xác nhận giao dịch hoàn tiền thực tế.</label>
              <button className="brew-btn brew-btn-primary" type="submit">Xác nhận đã hoàn tiền</button></form>
              <form className="tracking-form" onSubmit={e=>refund(e,'FAILED')}><label>Lý do hoàn tiền thất bại<textarea name="note" maxLength={500} required rows={3}/></label><button className="brew-btn brew-btn-danger" type="submit">Ghi nhận hoàn tiền thất bại</button></form></div>}
            {data.refund.status==='FAILED'&&<button className="brew-btn brew-btn-secondary" type="button" onClick={()=>void mutate(`/admin/orders/${id}/refund`,{action:'RETRY',expectedVersion:data.refund!.version})}>Mở lại xử lý hoàn tiền</button>}
          </fieldset>}
          {role==='ADMIN'&&data.refund.status==='SUCCEEDED'&&<p className="tracking-muted">Mã giao dịch: {data.refund.transactionReference} · Bằng chứng: {data.refund.evidenceReference}</p>}
        </div>}
      </div>

      {data.cancelUntil&&<form onSubmit={support} className="tracking-panel tracking-form-panel">
        <fieldset disabled={busy||!!error} className="tracking-fieldset">
          <legend>Yêu cầu hỗ trợ ngoại lệ</legend>
          <div className="tracking-form">
            <label htmlFor={`support-reason-${id}`}>Lý do cần hỗ trợ</label>
            <textarea id={`support-reason-${id}`} name="reason" maxLength={500} required rows={3} placeholder="Mô tả sự cố để nhân viên và Admin xử lý"/>
            <div className="tracking-form-actions">
              <button className="brew-btn brew-btn-primary" type="submit">Gửi yêu cầu hỗ trợ</button>
            </div>
          </div>
        </fieldset>
      </form>}

      {data.supportRequests.length>0&&<div className="tracking-support-list">
        {data.supportRequests.map(s=><article key={s.id} className="tracking-support-card">
          <div className="tracking-panel-head">
            <h3>Yêu cầu hỗ trợ</h3>
            <span className={`tracking-pill tracking-pill-${s.status.toLowerCase()}`}>{eventLabels[s.status]}</span>
          </div>
          <p className="tracking-support-reason">{s.reason}</p>
          {s.reviewNote&&<p className="tracking-support-note"><strong>Phản hồi:</strong> {s.reviewNote}</p>}
          {role==='ADMIN'&&s.status==='OPEN'&&<form onSubmit={e=>review(e,s)} className="tracking-form"><fieldset disabled={busy||!!error} className="tracking-fieldset"><legend>Admin xử lý yêu cầu</legend>
            <label>Lý do xử lý<textarea name="note" maxLength={500} required rows={2}/></label>
            <div className="tracking-form-actions">
              <button className="brew-btn brew-btn-primary" type="submit" value="APPROVE">Duyệt xử lý</button>
              <button className="brew-btn brew-btn-danger" type="submit" value="REJECT">Từ chối</button>
            </div>
          </fieldset></form>}
        </article>)}
      </div>}

      <div className="tracking-panel">
        <h3>Lịch sử cập nhật</h3>
        {data.events.length?<ol className="tracking-timeline">{data.events.map(e=><li key={e.id} className="tracking-timeline-item">
          <span className="tracking-timeline-dot" aria-hidden="true"/>
          <div className="tracking-timeline-body">
            <div className="tracking-timeline-top">
              <strong>{e.kind==='REFUND'&&e.status==='PENDING'?'Đã tạo yêu cầu hoàn tiền':eventLabels[e.status]??e.status}</strong>
              <span className="tracking-timeline-role">{roleLabels[e.actorRole]}</span>
            </div>
            <time className="tracking-timeline-time" dateTime={e.at}>{formatOrderTime(e.at)}</time>
            {e.note&&<p className="tracking-timeline-note">{e.note}</p>}
          </div>
        </li>)}</ol>:<p className="tracking-muted">Chưa có lịch sử cập nhật được ghi nhận cho đơn này.</p>}
      </div>
    </>}
    <div className="tracking-footer">
      <button className="brew-btn brew-btn-secondary" type="button" disabled={busy} onClick={()=>setRevision(v=>v+1)}>Tải lại tiến độ</button>
    </div>
  </section>;
}
export function TrackingPhase({data,customer,disabled,cancel,confirm,setConfirm,allowUnpaidCancel=true}:{data:Tracking;customer:boolean;disabled:boolean;cancel:()=>void;confirm:boolean;setConfirm:(value:boolean)=>void;allowUnpaidCancel?:boolean}){
  const elapsed=useElapsed();
  const remaining=data.cancelUntil?Math.max(0,Math.ceil((Date.parse(data.cancelUntil)-Date.parse(data.serverNow)-elapsed)/1000)):0;
  const allowed=customer&&(allowUnpaidCancel&&['PENDING','PAYMENT_FAILED'].includes(data.status)||data.status==='PAID'&&data.canCancelPaid&&remaining>0);
  const paidCancellation=customer&&['PAID','PREPARING','READY','COMPLETED'].includes(data.status);
  const blockedReason=!allowed&&paidCancellation?(data.status==='PAID'?(data.cancelUntil===null?'Chưa xác định được thời hạn hủy từ máy chủ. Hãy tải lại tiến độ trước khi hủy.':'Đã hết thời hạn hủy 120 giây sau thanh toán. Bạn có thể gửi yêu cầu hỗ trợ bên dưới.'):'Đơn đã bắt đầu được xử lý nên không thể tự hủy. Bạn có thể gửi yêu cầu hỗ trợ bên dưới.'):null;
  return <div className="tracking-phase">
    <div className="tracking-phase-row">
      <p role="status" className="tracking-phase-status" data-tracking-phase={data.status==='PAID'?(remaining>0?'CANCEL_WINDOW':'WAITING_STAFF'):data.status}>
        {data.status==='PAID'?(remaining>0?`Chờ pha chế — có thể hủy trong ${remaining} giây`:'Chờ nhân viên bắt đầu'):orderStatusLabels[data.status as keyof typeof orderStatusLabels]}
      </p>
      {(allowed||paidCancellation)&&(!confirm||!allowed)&&<button className="brew-btn brew-btn-danger tracking-cancel-btn" type="button" data-paid-cancel={paidCancellation||undefined} disabled={disabled||!allowed} aria-describedby={blockedReason?'paid-cancel-reason':undefined} onClick={()=>setConfirm(true)}>Hủy đơn hàng</button>}
    </div>
    {blockedReason&&<p id="paid-cancel-reason" className="tracking-blocked-reason">{blockedReason}</p>}
    {confirm&&allowed&&<fieldset disabled={disabled} className="tracking-confirm-box"><legend>Xác nhận hủy đơn</legend><p>Hủy đơn sẽ giải phóng phần nguyên liệu chưa dùng. Nếu đã thu tiền, hệ thống tạo yêu cầu hoàn tiền và theo dõi riêng.</p>
      <div className="tracking-form-actions">
        <button className="brew-btn brew-btn-danger" type="button" onClick={cancel}>Xác nhận hủy đơn hàng</button>
        <button className="brew-btn brew-btn-secondary" type="button" onClick={()=>setConfirm(false)}>Giữ đơn hàng</button>
      </div></fieldset>}
  </div>;
}

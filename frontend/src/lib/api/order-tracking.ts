import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import { validOrderId } from '../order-display';
import { OrderError } from './orders';
export type Tracking = {
  orderId: string; status: string; serverNow: string; cancelUntil: string|null; canCancelPaid: boolean; canStartPreparing: boolean;
  refund: null | {id:string;status:'PENDING'|'SUCCEEDED'|'FAILED';amount:string;approved:boolean;version:number;createdAt:string;processedAt:string|null;failureReason:string|null;transactionReference?:string|null;evidenceReference?:string|null};
  supportRequests: {id:string;reason:string;status:'OPEN'|'APPROVED'|'REJECTED';version:number;reviewNote:string|null;createdAt:string}[];
  events:{id:string;kind:'STATUS'|'SUPPORT'|'REFUND';fromStatus:string|null;status:string;actorRole:string;note:string|null;at:string}[];
};
const date = (value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const revision = (value:unknown)=>typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647;
export function parseTracking(value:unknown):Tracking {
  if(!value||typeof value!=='object')throw new OrderError('UNAVAILABLE');
  const t=value as Tracking;
  if(!validOrderId(t.orderId)||!['PENDING','PAYMENT_FAILED','PAID','PREPARING','READY','COMPLETED','CANCELLED'].includes(t.status)||!date(t.serverNow)
    ||!(t.cancelUntil===null||date(t.cancelUntil))||typeof t.canCancelPaid!=='boolean'||typeof t.canStartPreparing!=='boolean'
    ||!Array.isArray(t.supportRequests)||!Array.isArray(t.events))throw new OrderError('UNAVAILABLE');
  const r=t.refund;
  if(r!==null&&(!r||!validOrderId(r.id)||!['PENDING','SUCCEEDED','FAILED'].includes(r.status)||typeof r.amount!=='string'||!/^([1-9]\d{0,11})$/.test(r.amount)
    ||typeof r.approved!=='boolean'||!revision(r.version)||!date(r.createdAt)||!(r.processedAt===null||date(r.processedAt))||!(r.failureReason===null||typeof r.failureReason==='string')
    ||r.status==='SUCCEEDED'&&(!r.approved||!r.processedAt)||r.status==='FAILED'&&(!r.processedAt||!r.failureReason)))throw new OrderError('UNAVAILABLE');
  const supports=t.supportRequests.map(s=>{
    if(!s||!validOrderId(s.id)||typeof s.reason!=='string'||!s.reason||!['OPEN','APPROVED','REJECTED'].includes(s.status)||!revision(s.version)||!date(s.createdAt)||!(s.reviewNote===null||typeof s.reviewNote==='string'))throw new OrderError('UNAVAILABLE');
    return {id:s.id,reason:s.reason,status:s.status,version:s.version,reviewNote:s.reviewNote,createdAt:s.createdAt};
  });
  const events=t.events.map(e=>{
    if(!e||!validOrderId(e.id)||!['STATUS','SUPPORT','REFUND'].includes(e.kind)||typeof e.status!=='string'||!date(e.at)||!['SYSTEM','CUSTOMER','STAFF','ADMIN'].includes(e.actorRole)
      ||!(e.fromStatus===null||typeof e.fromStatus==='string')||!(e.note===null||typeof e.note==='string'))throw new OrderError('UNAVAILABLE');
    return {id:e.id,kind:e.kind,fromStatus:e.fromStatus,status:e.status,actorRole:e.actorRole,note:e.note,at:e.at};
  });
  return {orderId:t.orderId,status:t.status,serverNow:t.serverNow,cancelUntil:t.cancelUntil,canCancelPaid:t.canCancelPaid,canStartPreparing:t.canStartPreparing,
    refund:r?{id:r.id,status:r.status,amount:r.amount,approved:r.approved,version:r.version,createdAt:r.createdAt,processedAt:r.processedAt,failureReason:r.failureReason,
      ...(typeof r.transactionReference==='string'||r.transactionReference===null?{transactionReference:r.transactionReference}:{}),
      ...(typeof r.evidenceReference==='string'||r.evidenceReference===null?{evidenceReference:r.evidenceReference}:{})}:null,supportRequests:supports,events};
}
export async function trackingRequest(path:string,body?:object,key?:string,signal?:AbortSignal):Promise<unknown>{
  const token=getAccessToken(),user=useAuthStore.getState().user;
  if(!token||!user)throw new OrderError('UNAUTHORIZED');
  const sameSession=()=>{const s=useAuthStore.getState();return s.accessToken===token&&s.user?.id===user.id&&s.user.role===user.role;};
  try{
    const timeout=AbortSignal.timeout(10000);
    const response=await fetch(getApiBaseUrl()+path,{method:body?'POST':'GET',credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout,
      headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!sameSession())throw new OrderError('UNAUTHORIZED');
    if(response.status===401){useAuthStore.getState().clear();throw new OrderError('UNAUTHORIZED');}
    const result=await response.json();if(!sameSession())throw new OrderError('UNAUTHORIZED');
    if(!response.ok)throw new OrderError(result?.error?.code??'UNAVAILABLE');return result;
  }catch(error){if(error instanceof OrderError)throw error;throw new OrderError('UNAVAILABLE');}
}
export async function getTracking(id:string,signal?:AbortSignal){
  if(!validOrderId(id))throw new OrderError('ORDER_NOT_FOUND');const result=parseTracking(await trackingRequest('/orders/'+id+'/tracking',undefined,undefined,signal));
  if(result.orderId!==id)throw new OrderError('UNAVAILABLE');return result;
}
export function remainingPaidWindow(paidAt:string|null|undefined,serverNow:string|undefined,elapsed=0):number|null{
  if(!paidAt||!serverNow||!date(paidAt)||!date(serverNow))return null;
  return Math.max(0,Math.ceil((Date.parse(paidAt)+120000-Date.parse(serverNow)-elapsed)/1000));
}
export function trackingError(error:unknown){
  const code=error instanceof OrderError?error.code:'';
  if(code==='CANCEL_WINDOW_EXPIRED')return 'Đã hết 120 giây. Bạn có thể gửi yêu cầu hỗ trợ.';
  if(code==='PREPARATION_LOCKED')return 'Chưa hết thời hạn hủy. Hãy chờ đồng hồ kết thúc và tải lại đơn.';
  if(code==='REFUND_EVIDENCE_REQUIRED')return 'Cần phê duyệt, mã giao dịch và bằng chứng xác nhận hoàn tiền hợp lệ.';
  if(code==='CONCURRENT_UPDATE')return 'Dữ liệu đã thay đổi. Tải lại trước khi xử lý tiếp.';
  if(code==='IDEMPOTENCY_KEY_REUSED')return 'Nội dung khác yêu cầu đã gửi. Hãy kiểm tra lại yêu cầu hỗ trợ.';
  if(code==='UNAUTHORIZED')return 'Vui lòng đăng nhập lại.';
  if(code==='FORBIDDEN')return 'Bạn không có quyền xử lý yêu cầu này.';
  return 'Chưa xác nhận được kết quả. Tải lại trạng thái trước khi tiếp tục.';
}

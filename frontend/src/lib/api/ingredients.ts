import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import type { Ingredient, IngredientCount, IngredientReceipt, InventoryPage, MovementRow, IngredientUnit, IngredientCommand, IngredientSummary, InventoryCategory } from '../../types/ingredient';
export class IngredientError extends Error { constructor(readonly code: string) { super(code); } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const unitLabels: Record<IngredientUnit,string> = { KG: 'kg', G: 'g', L: 'lít', ML: 'ml', PIECE: 'cái', EGG:'quả' };
export const inventoryCategory=(unit:IngredientUnit):InventoryCategory=>unit==='PIECE'?'supplies':'materials';
export const inventoryThresholds:Record<IngredientUnit,string>={PIECE:'10',L:'5',KG:'10',G:'10000',ML:'5000',EGG:'10'};
export function normalizeQuantity(value: string, unit: IngredientUnit, positive = false): string | null {
  const raw = value.trim().replace(',','.');
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(raw)) return null;
  const scaled = BigInt(raw.split('.')[0])*1000n+BigInt((raw.split('.')[1]??'').padEnd(3,'0'));
  if ((positive && scaled===0n) || (['PIECE','EGG'].includes(unit) && scaled%1000n!==0n)) return null;
  return `${scaled/1000n}.${(scaled%1000n).toString().padStart(3,'0')}`;
}
export function quantityDifference(actual: string, system: string): string {
  const scaled = (v: string) => { const [a,b='']=v.split('.'); return BigInt(a)*1000n+BigInt(b.padEnd(3,'0')); };
  const diff = scaled(actual)-scaled(system), magnitude=diff<0n?-diff:diff;
  return `${diff<0n?'-':''}${magnitude/1000n}.${(magnitude%1000n).toString().padStart(3,'0')}`;
}
export function displayQuantity(v: string) { return Number(v).toLocaleString('vi-VN',{maximumFractionDigits:3}); }
export const ingredientMessages: Record<string,string> = {
  UNAUTHORIZED:'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.', FORBIDDEN:'Bạn không có quyền thực hiện thao tác này.',
  INVENTORY_CHANGED:'Tồn kho đã thay đổi sau lần kiểm kê. Hãy tải lại và kiểm kê lại; số lượng mới chưa bị ghi đè.',
  INVALID_DOCUMENT_STATE:'Phiếu đã được xử lý hoặc không còn cho phép thao tác này. Hãy tải lại danh sách.',
  INGREDIENT_EXISTS:'Tên nguyên liệu đã tồn tại.', INGREDIENT_NOT_FOUND:'Nguyên liệu không còn tồn tại.',
  INVALID_QUANTITY:'Số lượng không hợp lệ hoặc vượt giới hạn; đơn vị cái và quả phải là số nguyên.', VALIDATION_ERROR:'Kiểm tra tên, số lượng, ghi chú và các dòng của phiếu.',
  INGREDIENT_UNIT_MISMATCH:'Có mặt hàng trong danh mục đang dùng đơn vị khác. Tồn và lịch sử được giữ nguyên; hãy đối chiếu đơn vị trước khi nhập hàng.',
  IDEMPOTENCY_KEY_REUSED:'Mã yêu cầu đã dùng cho nội dung khác. Giữ phiếu và kiểm tra lại kết quả.',
  CONCURRENT_UPDATE:'Có cập nhật đồng thời. Giữ nguyên yêu cầu và thử xác nhận lại kết quả.',
};
export async function ingredientRequest<T>(path: string, body?: object, key?: string, signal?: AbortSignal): Promise<T> {
  const token=getAccessToken(),user=useAuthStore.getState().user;
  if (!token||!user) throw new IngredientError('UNAUTHORIZED');
  if (!['ADMIN','STAFF'].includes(user.role)) throw new IngredientError('FORBIDDEN');
  try {
    const r=await fetch(`${getApiBaseUrl()}/ingredient-inventory/${path}`,{method:body?'POST':'GET',cache:'no-store',credentials:'omit',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000),...(body?{body:JSON.stringify(body)}:{})});
    const state=useAuthStore.getState();if(state.accessToken!==token||state.user?.id!==user.id||state.user.role!==user.role)throw new IngredientError('UNAUTHORIZED');
    if(r.status===401){useAuthStore.getState().clear();throw new IngredientError('UNAUTHORIZED');}
    const value:unknown=await r.json();
    if(!r.ok){const e=value as {error?:{code?:unknown}};throw new IngredientError(r.status===403?'FORBIDDEN':typeof e.error?.code==='string'?e.error.code:'UNAVAILABLE');}
    return value as T;
  }catch(e){if(e instanceof IngredientError)throw e;throw new IngredientError('UNAVAILABLE');}
}
export const getIngredients=(signal?:AbortSignal)=>ingredientRequest<{items:Ingredient[]}>('ingredients',undefined,undefined,signal);
export async function getIngredientSummary(signal?:AbortSignal) {
  const summary=await ingredientRequest<IngredientSummary>('summary',undefined,undefined,signal);
  if(!summary||!['totalIngredients','inStock','lowStock','outOfStock','pendingCounts'].every(k=>Number.isSafeInteger(summary[k as keyof IngredientSummary])&&summary[k as keyof IngredientSummary]>=0)||summary.inStock+summary.lowStock+summary.outOfStock!==summary.totalIngredients)throw new IngredientError('UNAVAILABLE');
  return summary;
}
export const getReceipts=(cursor?:string,signal?:AbortSignal)=>ingredientRequest<InventoryPage<IngredientReceipt>>('receipts'+(cursor?'?cursor='+encodeURIComponent(cursor):''),undefined,undefined,signal);
export const getCounts=(cursor?:string,signal?:AbortSignal)=>ingredientRequest<InventoryPage<IngredientCount>>('counts'+(cursor?'?cursor='+encodeURIComponent(cursor):''),undefined,undefined,signal);
export const getMovements=(cursor?:string,signal?:AbortSignal)=>ingredientRequest<InventoryPage<MovementRow>>('movements'+(cursor?'?cursor='+encodeURIComponent(cursor):''),undefined,undefined,signal);
export async function loadIngredientSections(admin:boolean,signal?:AbortSignal,on:{ingredients?:(v:{items:Ingredient[]})=>void;summary?:(v:IngredientSummary)=>void;counts?:(v:InventoryPage<IngredientCount>)=>void;receipts?:(v:InventoryPage<IngredientReceipt>)=>void;movements?:(v:InventoryPage<MovementRow>)=>void}={}) {
  const [ingredients,summary,counts,receipts,movements]=await Promise.allSettled([
    getIngredients(signal).then(v=>{on.ingredients?.(v);return v;}),
    getIngredientSummary(signal).then(v=>{on.summary?.(v);return v;}),
    getCounts(undefined,signal).then(v=>{on.counts?.(v);return v;}),
    admin?getReceipts(undefined,signal).then(v=>{on.receipts?.(v);return v;}):Promise.resolve({items:[],nextCursor:null}),
    admin?getMovements(undefined,signal).then(v=>{on.movements?.(v);return v;}):Promise.resolve({items:[],nextCursor:null}),
  ]);
  return {ingredients,summary,counts,receipts,movements};
}
const storageKey='brewlite:ingredient-command:v1';
export function saveIngredientCommand(command:IngredientCommand){try{sessionStorage.setItem(storageKey,JSON.stringify(command));return true;}catch{return false;}}
export function clearIngredientCommand(){try{sessionStorage.removeItem(storageKey);}catch{/* Storage may be disabled. */}}
export function readIngredientCommand(userId:string,role:string):IngredientCommand|null {
  try{const raw=sessionStorage.getItem(storageKey);if(!raw)return null;const c=JSON.parse(raw) as IngredientCommand;
    if(c.userId!==userId||c.role!==role){clearIngredientCommand();return null;}
    const allowed=role==='ADMIN'?/^(ingredients|receipts|receipts\/[0-9a-f-]+\/confirm|counts\/[0-9a-f-]+\/review)$/:/^counts$/;
    if(!uuid.test(c.userId)||!uuid.test(c.key)||!allowed.test(c.path)||!c.body||typeof c.body!=='object'||Array.isArray(c.body))throw Error();
    return c;
  }catch{clearIngredientCommand();return null;}
}

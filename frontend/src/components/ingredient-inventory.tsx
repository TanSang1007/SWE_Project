'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '../lib/auth-store';
import { clearIngredientCommand, displayQuantity, getCounts, getMovements, getReceipts, ingredientMessages, ingredientName, ingredientRequest, IngredientError, inventoryCategory, listedIngredients, listedIngredientSummary, loadIngredientSections, readIngredientCommand, saveIngredientCommand, unitLabels } from '../lib/api/ingredients';
import type { Ingredient, IngredientCommand, IngredientCount, IngredientReceipt, IngredientSummary, InventoryCategory, InventoryPage, MovementRow } from '../types/ingredient';
import { ConfirmReceipt, CountForm, ReceiptForm, ReviewCount } from './ingredient-forms';
import { InventoryControlForm } from './inventory-control-form';
const date=(s:string)=>new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'});
const countDay=(s:string)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s));
const controlLabels={MATCHED:'Khớp',WITHIN_THRESHOLD:'Trong ngưỡng kiểm soát',ABNORMAL:'Cảnh báo bất thường',UNCONFIGURED:'Chưa cấu hình ngưỡng'};
export const ingredientStatusLabels={IN_STOCK:'Còn hàng',LOW_STOCK:'Sắp hết',OUT_OF_STOCK:'Hết hàng'};
export const documentStatusLabels={DRAFT:'Nháp',CONFIRMED:'Đã nhập kho',SUBMITTED:'Chờ phê duyệt',APPROVED:'Đã phê duyệt',REJECTED:'Đã từ chối',RECOUNT_REQUIRED:'Cần kiểm kê lại'};
const movementLabels={RECEIPT:'Nhập hàng',COUNT:'Phê duyệt kiểm kê',ORDER_RESERVE:'Giữ nguyên liệu cho đơn',ORDER_RELEASE:'Giải phóng nguyên liệu',ORDER_CONSUME:'Pha chế theo công thức',LEGACY:'Biến động trước đây'};
export function IngredientTable({items,category,receivingLinks=false}:{items:Ingredient[];category?:InventoryCategory;receivingLinks?:boolean}) {
  const [filter,setFilter]=useState('ALL');const rows=listedIngredients(items).filter(i=>filter==='ALL'||i.status===filter);
  const measured=(value:string)=>Number(value).toLocaleString('vi-VN',{maximumFractionDigits:6});
  return <section><h2>Tồn kho {category==='supplies'?'vật dụng':category==='materials'?'nguyên liệu':'vật dụng và nguyên liệu'}</h2>
    <label className="ingredient-filter">Trạng thái tồn kho<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">Tất cả {category==='supplies'?'vật dụng':category==='materials'?'nguyên liệu':'mặt hàng'}</option>{Object.entries(ingredientStatusLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <p>Có thể bán = tồn thực tế − lượng đã giữ cho đơn hàng. Cảnh báo dựa trên lượng có thể bán.</p>
    {!rows.length?<p>Chưa có {category==='supplies'?'vật dụng':category==='materials'?'nguyên liệu':'mặt hàng'} phù hợp.</p>:<div className="ingredient-table-wrap"><table>
      <caption>Số lượng trên hệ thống tại lần tải gần nhất</caption>
      <thead><tr><th>Mặt hàng</th><th>Tồn thực tế</th><th>Có thể bán</th><th>{category==='supplies'&&rows.every(i=>!i.lowStockInclusive)?'Cảnh báo khi dưới':rows.every(i=>i.lowStockInclusive)?'Ngưỡng cảnh báo (≤)':'Ngưỡng cảnh báo'}</th><th>Trạng thái</th><th>Cập nhật lúc</th><th>Người cập nhật</th>{receivingLinks&&<th>Nhập bổ sung</th>}</tr></thead>
      <tbody>{rows.map(i=><tr key={i.id}>
        <th scope="row">{ingredientName(i)}</th><td>{displayQuantity(i.quantity)} {unitLabels[i.unit]}</td>
        <td>{displayQuantity(i.availableQuantity??i.quantity)} {unitLabels[i.unit]}</td>
        <td>{i.lowStockInclusive?'≤ ':'Dưới '}{measured(i.lowStockThreshold)} {unitLabels[i.unit]}</td>
        <td><span className={`ingredient-status ${i.status.toLowerCase()}`}>{ingredientStatusLabels[i.status]}</span></td>
        <td>{date(i.updatedAt)}</td><td>{(i.updatedBy??i.createdBy).email}</td>
        {receivingLinks&&<td>{i.status!=='IN_STOCK'&&<Link href={'/admin/receipts?category='+inventoryCategory(i.unit)}>Nhập thêm</Link>}</td>}
      </tr>)}</tbody></table></div>}</section>;
}
export function IngredientSummaryCards({summary,admin}:{summary:IngredientSummary;admin:boolean}) {
  return <dl className="ingredient-summary">{[[admin?'Tổng mặt hàng':'Tổng số nguyên liệu',summary.totalIngredients],['Sắp hết hàng',summary.lowStock],['Hết hàng',summary.outOfStock],[admin?'Phiếu chờ duyệt':'Phiếu của tôi chờ duyệt',summary.pendingCounts]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
type InventoryView='stock'|'receiving';
export function IngredientInventory({view='stock',initialCategory='supplies'}:{view?:InventoryView;initialCategory?:InventoryCategory}) {
  const {user,accessToken}=useAuthStore();if(!accessToken||!user||!['ADMIN','STAFF'].includes(user.role))return null;
  return <InventorySession key={`${accessToken}:${user.id}:${user.role}:${view}:${initialCategory}`} userId={user.id} role={user.role as 'ADMIN'|'STAFF'} view={view} initialCategory={initialCategory}/>;
}
function InventorySession({userId,role,view,initialCategory}:{userId:string;role:'ADMIN'|'STAFF';view:InventoryView;initialCategory:InventoryCategory}) {
  const admin=role==='ADMIN',receiving=admin&&view==='receiving',[category,setCategory]=useState(initialCategory),[tab,setTab]=useState(receiving?'receipts':'inventory'),[items,setItems]=useState<Ingredient[]|null>(null),[receipts,setReceipts]=useState<InventoryPage<IngredientReceipt>>({items:[],nextCursor:null}),[counts,setCounts]=useState<InventoryPage<IngredientCount>>({items:[],nextCursor:null}),[movements,setMovements]=useState<InventoryPage<MovementRow>>({items:[],nextCursor:null});
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<IngredientCommand|null>(null),[revision,setRevision]=useState(0),[recount,setRecount]=useState<IngredientCount|null>(null);
  const [summary,setSummary]=useState<IngredientSummary|null>(null),[sectionErrors,setSectionErrors]=useState<Record<string,string>>({});
  const [selectedCountDay,setSelectedCountDay]=useState('');
  const gate=useRef(false),alive=useRef(true),token=useAuthStore(s=>s.accessToken);
  const current=useCallback(()=>{const s=useAuthStore.getState();return alive.current&&s.user?.id===userId&&s.user.role===role&&s.accessToken===token;},[userId,role,token]);
  const load=useCallback(async(signal?:AbortSignal)=>{
    const valid=()=>current()&&!signal?.aborted;
    let catalogError:unknown;
    if(admin){try{await ingredientRequest('catalog/initialize',{},undefined,signal);}catch(e){catalogError=e;}}
    if(!valid())return;
    const results=await loadIngredientSections(admin,signal,{
      ingredients:v=>{if(valid()){setItems(v.items);setRevision(n=>n+1);}},summary:v=>{if(valid())setSummary(v);},
      counts:v=>{if(valid())setCounts(v);},receipts:v=>{if(valid())setReceipts(v);},movements:v=>{if(valid())setMovements(v);},
    });
    if(!valid())return;
    const failures:Record<string,string>={},labels:Record<string,string>={ingredients:'Danh sách nguyên liệu',summary:'Thống kê',counts:'Lịch sử kiểm kê',receipts:'Phiếu nhập',movements:'Lịch sử biến động'};
    if(catalogError){const code=catalogError instanceof IngredientError?catalogError.code:'UNAVAILABLE';failures.catalog=ingredientMessages[code]??'Chưa bổ sung được danh mục nhập hàng. Hãy tải lại dữ liệu.';}
    for(const [key,result]of Object.entries(results))if(result.status==='rejected'){const code=result.reason instanceof IngredientError?result.reason.code:'UNAVAILABLE';failures[key]=`${labels[key]}: ${ingredientMessages[code]??'Chưa tải được dữ liệu. Hãy thử lại.'}`;}
    setSectionErrors(failures);setError(Object.values(failures).join(' '));
  },[admin,current]);
  useEffect(()=>{alive.current=true;const abort=new AbortController();void Promise.resolve().then(()=>{if(current())setPending(readIngredientCommand(userId,role));return load(abort.signal);}).catch((e:unknown)=>{if(current()&&!abort.signal.aborted)setError(ingredientMessages[e instanceof IngredientError?e.code:'']??'Chưa tải được tồn kho. Hãy thử lại.');}).finally(()=>{if(current()&&!abort.signal.aborted)setBusy(false);});return()=>{alive.current=false;abort.abort();};},[load,current,userId,role]);
  useEffect(()=>{
    if(receiving||tab!=='inventory'||busy||pending)return;
    const abort=new AbortController();
    function refreshStock(){if(document.visibilityState==='hidden'||gate.current)return;gate.current=true;void load(abort.signal).catch(()=>{}).finally(()=>{gate.current=false;});}
    const timer=window.setInterval(refreshStock,20000);window.addEventListener('focus',refreshStock);
    return()=>{abort.abort();window.clearInterval(timer);window.removeEventListener('focus',refreshStock);};
  },[receiving,tab,busy,pending,load]);
  async function refresh(){if(gate.current)return;gate.current=true;setBusy(true);setError('');try{await load();}catch{if(current())setError('Chưa tải lại được dữ liệu. Giữ nguyên phiếu nếu kết quả chưa rõ.');}finally{gate.current=false;if(current())setBusy(false);}}
  async function send(command:IngredientCommand){if(gate.current)return;gate.current=true;setBusy(true);setError('');setNotice('');setPending(command);
    try{await ingredientRequest(command.path,command.body,command.key);if(!current())return;clearIngredientCommand();setPending(null);setRecount(null);setNotice('Máy chủ đã xác nhận thao tác.');try{await load();}catch{if(current())setError('Thao tác đã được xác nhận, nhưng chưa tải lại danh sách. Hãy tải lại dữ liệu.');}}
    catch(e){if(!current())return;const code=e instanceof IngredientError?e.code:'UNAVAILABLE';setError(ingredientMessages[code]??'Chưa xác định được kết quả. Giữ nguyên yêu cầu và chọn Kiểm tra lại yêu cầu.');
      if(['VALIDATION_ERROR','INVALID_QUANTITY','INGREDIENT_EXISTS','INGREDIENT_NOT_FOUND','INGREDIENT_NOT_RECEIVABLE','INVENTORY_COUNT_NOT_SUPPORTED','DOCUMENT_NOT_FOUND','INVALID_DOCUMENT_STATE','INVENTORY_CHANGED','MISSING_IDEMPOTENCY_KEY','FORBIDDEN'].includes(code)){clearIngredientCommand();setPending(null);}}
    finally{gate.current=false;if(current())setBusy(false);}}
  function submit(path:string,body:object){if(gate.current||busy||pending)return;const command:IngredientCommand={userId,role,path,body,key:crypto.randomUUID()};if(!saveIngredientCommand(command)){setError('Không lưu được yêu cầu khôi phục trong trình duyệt. Hãy cho phép lưu trữ phiên trước khi gửi.');return;}void send(command);}
  async function more(kind:'receipts'|'counts'|'movements'){if(gate.current)return;const cursor=kind==='receipts'?receipts.nextCursor:kind==='counts'?counts.nextCursor:movements.nextCursor;if(!cursor)return;gate.current=true;setBusy(true);setError('');try{
    if(kind==='receipts'){const next=await getReceipts(cursor);if(current())setReceipts(old=>({items:[...old.items,...next.items.filter(n=>!old.items.some(o=>o.id===n.id))],nextCursor:next.nextCursor}));}
    if(kind==='counts'){const next=await getCounts(cursor);if(current())setCounts(old=>({items:[...old.items,...next.items.filter(n=>!old.items.some(o=>o.id===n.id))],nextCursor:next.nextCursor}));}
    if(kind==='movements'){const next=await getMovements(cursor);if(current())setMovements(old=>({items:[...old.items,...next.items.filter(n=>!old.items.some(o=>o.id===n.id))],nextCursor:next.nextCursor}));}
  }catch{if(current())setError('Chưa tải thêm được lịch sử. Hãy thử lại.');}finally{gate.current=false;if(current())setBusy(false);}}
  const disabled=busy||!!pending||!!sectionErrors.ingredients;
  const categoryItems=listedIngredients(items??[]).filter(i=>!admin||inventoryCategory(i.unit)===category);
  const visibleReceipts=tab==='history'?receipts.items:receipts.items.filter(doc=>doc.lines.some(l=>inventoryCategory(l.ingredient.unit)===category));
  return <section className="ingredient-inventory" aria-busy={busy}><div className="operations-page-header"><p className="eyebrow">BrewLite / {admin?'Quản trị':'Nhân viên'}</p><h1>{admin?(receiving?'Nhập hàng':'Quản lý tồn kho'):'Kiểm kê nguyên liệu'}</h1><p className="section-note">{receiving?'Nhập vật dụng, nguyên liệu và theo dõi lịch sử nhập hàng.':'Theo dõi vật dụng và nguyên liệu theo đơn vị thực tế. Nhập bổ sung tại chức năng Nhập hàng.'}</p></div>
    <div className="ingredient-actions"><button disabled={busy} onClick={()=>void refresh()}>Tải lại dữ liệu</button></div>
    {busy&&<p role="status">Đang tải / xử lý nguyên liệu…</p>}{error&&<p role="alert" className="ingredient-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {summary&&items&&<IngredientSummaryCards summary={listedIngredientSummary(items,summary)} admin={admin}/>}
    {pending&&<aside className="ingredient-card" role="alert"><p>Còn yêu cầu cần xác nhận kết quả. Các thao tác mới tạm khóa để tránh tạo phiếu trùng.</p><button className="button" disabled={busy} onClick={()=>void send(pending)}>Kiểm tra lại yêu cầu</button></aside>}
    {admin&&<nav aria-label={receiving?'Lựa chọn nhập hàng':'Nhóm tồn kho'} className="ingredient-tabs">{([['supplies',receiving?'Vật dụng':'Quản lý vật dụng'],['materials',receiving?'Nguyên liệu':'Quản lý nguyên liệu'],...(receiving?[['history','Lịch sử nhập hàng']]:[])]).map(([key,label])=><button key={key} aria-pressed={key==='history'?tab==='history':(tab!=='history'&&category===key)} onClick={()=>{if(key==='history')setTab('history');else{setCategory(key as InventoryCategory);setTab(receiving?'receipts':'inventory');}}}>{label}</button>)}</nav>}
    {!receiving&&<nav aria-label="Chức năng tồn kho" className="ingredient-tabs">{[['inventory','Danh sách tồn kho'],...(admin?[['counts','Duyệt kiểm kê'],['controls','Ngưỡng kiểm soát'],['movements','Lịch sử điều chỉnh']]:[['counts','Kiểm kê và phiếu của tôi']])].map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</nav>}
    {items&&tab==='inventory'&&<><IngredientTable items={categoryItems} category={admin?category:undefined} receivingLinks={admin}/>{admin&&<Link className="button" href={'/admin/receipts?category='+category}>Nhập {category==='supplies'?'vật dụng':'nguyên liệu'}</Link>}</>}
    {items&&admin&&tab==='controls'&&<InventoryControlForm items={items} busy={disabled} submit={submit}/>}
    {(tab==='receipts'||tab==='history')&&receiving&&<>{tab==='receipts'&&items&&<>{!categoryItems.length&&<p>Chưa có {category==='supplies'?'vật dụng':'nguyên liệu'} để nhập.</p>}<ReceiptForm key={`${revision}:${category}`} category={category} items={categoryItems} busy={disabled} submit={submit}/></>}<h2>{tab==='history'?'Lịch sử nhập vật dụng và nguyên liệu':'Phiếu nhập '+(category==='supplies'?'vật dụng':'nguyên liệu')}</h2>{!busy&&!sectionErrors.receipts&&!visibleReceipts.length&&<p>Chưa có phiếu nhập phù hợp.</p>}
      {visibleReceipts.map(doc=><article key={doc.id} className="ingredient-card"><h3>Phiếu nhập #{doc.id.slice(-8)}</h3><p><strong>{documentStatusLabels[doc.status]}</strong> · {date(doc.createdAt)} · {doc.createdBy.email}</p>{doc.note&&<p>Ghi chú: {doc.note}</p>}
        <ul>{doc.lines.map(l=><li key={l.id}><strong>{l.ingredient.name}</strong>: nhập {displayQuantity(l.quantity)} {unitLabels[l.ingredient.unit]}{l.movement?` · Trước: ${displayQuantity(l.movement.beforeQuantity)} → Sau: ${displayQuantity(l.movement.afterQuantity)}`:` · Hiện có: ${displayQuantity(l.ingredient.quantity)} · Dự kiến: ${displayQuantity((Number(l.ingredient.quantity)+Number(l.quantity)).toFixed(3))}`}</li>)}</ul>
        {doc.confirmedAt&&<p>Xác nhận: {doc.confirmedBy?.email} · {date(doc.confirmedAt)}</p>}{doc.status==='DRAFT'&&<ConfirmReceipt doc={doc} busy={disabled} submit={submit}/>}</article>)}
      {receipts.nextCursor&&<button disabled={busy} onClick={()=>void more('receipts')}>Xem thêm phiếu nhập</button>}</>}
    {tab==='counts'&&<>{!admin&&items&&<CountForm key={`${revision}:${recount?.id??''}`} items={items} busy={disabled} submit={submit} recount={recount} cancel={()=>setRecount(null)}/>}<h2>{admin?'Phiếu kiểm kê từ nhân viên':'Lịch sử kiểm kê của tôi'}</h2><label>Ngày kiểm kê (giờ Việt Nam)<input type="date" value={selectedCountDay} onChange={e=>setSelectedCountDay(e.target.value)}/></label>{selectedCountDay&&<button onClick={()=>setSelectedCountDay('')}>Xem mọi ngày</button>}{!busy&&!sectionErrors.counts&&!counts.items.filter(doc=>!selectedCountDay||countDay(doc.createdAt)===selectedCountDay).length&&<p>Chưa có phiếu kiểm kê phù hợp trong danh sách đã tải.</p>}
      {counts.items.filter(doc=>!selectedCountDay||countDay(doc.createdAt)===selectedCountDay).map(doc=><article key={doc.id} className="ingredient-card"><h3>Phiếu kiểm kê #{doc.id.slice(-8)}</h3><p><strong>{documentStatusLabels[doc.status]}</strong> · {date(doc.createdAt)} · {doc.createdBy.email}</p>{doc.recountOfId&&<p>Kiểm kê lại phiếu #{doc.recountOfId.slice(-8)}</p>}{doc.note&&<p>Ghi chú: {doc.note}</p>}{doc.periodStart&&<p>Kỳ tiêu hao: {date(doc.periodStart)} → {date(doc.createdAt)}.</p>}
        <div className="ingredient-table-wrap"><table><caption>Đối chiếu số lượng kiểm kê</caption><thead><tr><th>Nguyên liệu</th><th>Lý thuyết lúc kiểm kê</th><th>Thực tế kiểm kê</th><th>Chênh lệch</th><th>Tiêu hao trong kỳ</th><th>Tỷ lệ sai lệch</th><th>Kiểm soát</th><th>Tồn hiện tại</th><th>Ghi chú Staff</th></tr></thead><tbody>{doc.lines.map(l=><tr key={l.id}><th scope="row">{l.ingredient.name} ({unitLabels[l.ingredient.unit]})</th><td>{displayQuantity(l.systemQuantity)}</td><td>{displayQuantity(l.actualQuantity)}</td><td>{displayQuantity(l.difference)} · {Number(l.difference)===0?'Khớp tồn kho':Number(l.difference)<0?'Thiếu':'Thừa'}</td><td>{l.theoreticalConsumption==null?'Chưa có dữ liệu':displayQuantity(l.theoreticalConsumption)}</td><td>{l.variancePercent==null?'Xét chênh lệch tuyệt đối':`${displayQuantity(l.variancePercent)}%`}</td><td>{controlLabels[l.controlStatus??'UNCONFIGURED']}{l.controlStatus==='ABNORMAL'&&<p role="status">Cần đối chiếu nguyên nhân</p>}</td><td>{displayQuantity(l.ingredient.quantity)}</td><td>{l.note||'—'}</td></tr>)}</tbody></table></div>
        {doc.reviewedAt&&<p>Người xử lý: {doc.reviewedBy?.email} · {date(doc.reviewedAt)}{doc.reviewNote&&` · Lý do: ${doc.reviewNote}`}</p>}
        {admin&&doc.status==='SUBMITTED'&&<ReviewCount doc={doc} busy={disabled} submit={submit}/>}
        {!admin&&doc.status==='DRAFT'&&<button className="button" disabled={disabled} onClick={()=>submit(`counts/${doc.id}/submit`,{expectedVersion:doc.version})}>Gửi phiếu nháp cho Admin</button>}
        {!admin&&(doc.status==='RECOUNT_REQUIRED'||doc.recountRequested)&&!doc.replacementId&&<button disabled={disabled} onClick={()=>{setRecount(doc);window.scrollTo({top:0,behavior:'smooth'});}}>Thực hiện kiểm kê lại phiếu này</button>}
        {doc.replacementId&&<p>Đã có phiếu kiểm kê lại #{doc.replacementId.slice(-8)}.</p>}</article>)}
      {counts.nextCursor&&<button disabled={busy} onClick={()=>void more('counts')}>Xem thêm phiếu kiểm kê</button>}</>}
    {tab==='movements'&&admin&&<section><h2>Lịch sử nhập và điều chỉnh tồn kho</h2>{!movements.items.length?(!busy&&!sectionErrors.movements&&<p>Chưa phát sinh biến động nguyên liệu.</p>):<div className="ingredient-table-wrap"><table><caption>Mọi lần nhập hàng và kiểm kê được phê duyệt</caption><thead><tr><th>Thời gian</th><th>Nguyên liệu</th><th>Loại phiếu</th><th>Trước</th><th>Thay đổi</th><th>Sau</th><th>Người thực hiện</th></tr></thead><tbody>{movements.items.map(m=><tr key={m.id}><td>{date(m.createdAt)}</td><th scope="row">{m.ingredient.name} ({unitLabels[m.ingredient.unit]})</th><td>{movementLabels[m.kind]} #{m.documentId.slice(-8)}{m.committedQuantity&&<p>{displayQuantity(m.committedQuantity)} {unitLabels[m.ingredient.unit]}</p>}</td><td>{displayQuantity(m.beforeQuantity)}</td><td>{displayQuantity(m.delta)}</td><td>{displayQuantity(m.afterQuantity)}</td><td>{m.actor.email}</td></tr>)}</tbody></table></div>}{movements.nextCursor&&<button disabled={busy} onClick={()=>void more('movements')}>Xem thêm lịch sử biến động</button>}</section>}
  </section>;
}

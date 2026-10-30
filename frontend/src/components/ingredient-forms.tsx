'use client';
import { useState, type FormEvent } from 'react';
import { displayQuantity, inventoryThresholds, normalizeQuantity, quantityDifference, unitLabels } from '../lib/api/ingredients';
import type { Ingredient, IngredientCount, IngredientReceipt, IngredientUnit, InventoryCategory } from '../types/ingredient';
type Submit = (path:string,body:object)=>void;
export function NewIngredientForm({busy,submit,category='materials'}:{busy:boolean;submit:Submit;category?:InventoryCategory}) {
  const [name,setName]=useState(''),[unit,setUnit]=useState<IngredientUnit>(category==='supplies'?'PIECE':'KG'),[error,setError]=useState('');
  const label=category==='supplies'?'vật dụng':'nguyên liệu',units:IngredientUnit[]=category==='supplies'?['PIECE']:['L','KG','EGG'];
  function save(e:FormEvent){e.preventDefault();if(!name.trim()){setError('Nhập tên '+label+'.');return;}setError('');submit('ingredients',{name:name.trim(),unit});}
  return <form className="ingredient-card ingredient-form" onSubmit={save}><h2>Thêm {label}</h2><fieldset disabled={busy}><legend>Thông tin {label}</legend>
    <label>Tên {label}<input value={name} maxLength={120} required onChange={e=>setName(e.target.value)}/></label>
    <label>Đơn vị tính<select value={unit} onChange={e=>setUnit(e.target.value as IngredientUnit)}>{units.map(k=><option key={k} value={k}>{unitLabels[k]}</option>)}</select></label>
    <p>Cảnh báo sắp hết khi tồn dưới {inventoryThresholds[unit]} {unitLabels[unit]}. Bằng 0 là hết hàng.</p>
    <p>Tồn ban đầu là 0. Nhập hàng hoặc kiểm kê được phê duyệt để ghi nhận số lượng; đơn vị không thay đổi sau khi tạo.</p>
    <button className="button" type="submit">Thêm {label}</button></fieldset>{error&&<p role="alert">{error}</p>}</form>;
}
export function ReceiptForm({items,busy,submit,category='materials'}:{items:Ingredient[];busy:boolean;submit:Submit;category?:InventoryCategory}) {
  const [rows,setRows]=useState([{ingredientId:items[0]?.id??'',quantity:''}]),[note,setNote]=useState(''),[error,setError]=useState('');
  function save(e:FormEvent){e.preventDefault();const lines=rows.map(r=>{const i=items.find(i=>i.id===r.ingredientId);return i?{ingredientId:i.id,quantity:normalizeQuantity(r.quantity,i.unit,true)}:null;});
    if(!lines.length||lines.some(l=>!l||l.quantity===null)||new Set(rows.map(r=>r.ingredientId)).size!==rows.length){setError('Mỗi nguyên liệu chỉ xuất hiện một lần; lượng nhập phải lớn hơn 0 và đúng đơn vị.');return;}setError('');submit('receipts',{note,lines});}
  return <form className="ingredient-card ingredient-form" onSubmit={save}><h2>Tạo phiếu nhập {category==='supplies'?'vật dụng':'nguyên liệu'}</h2><fieldset disabled={busy||!items.length}><legend>Số lượng thực nhận</legend>
    {rows.map((row,index)=>{const i=items.find(i=>i.id===row.ingredientId),q=i?normalizeQuantity(row.quantity,i.unit,true):null;return <div className="ingredient-entry" key={index}>
      <label>{category==='supplies'?'Vật dụng':'Nguyên liệu'} {index+1}<select value={row.ingredientId} onChange={e=>setRows(rows.map((r,n)=>n===index?{ingredientId:e.target.value,quantity:''}:r))}>{items.map(i=><option key={i.id} value={i.id}>{i.name} ({unitLabels[i.unit]})</option>)}</select></label>
      <label>Số lượng nhập<input inputMode="decimal" value={row.quantity} required onChange={e=>setRows(rows.map((r,n)=>n===index?{...r,quantity:e.target.value}:r))}/></label>
      {i&&<p>Tồn hiện tại: {displayQuantity(i.quantity)} {unitLabels[i.unit]}{q&&` · Sau nhập dự kiến: ${displayQuantity((Number(i.quantity)+Number(q)).toFixed(3))} ${unitLabels[i.unit]}`}</p>}
      {rows.length>1&&<button type="button" onClick={()=>setRows(rows.filter((_,n)=>n!==index))}>Xóa dòng {index+1}</button>}</div>;})}
    <button type="button" disabled={rows.length>=Math.min(50,items.length)} onClick={()=>{const next=items.find(i=>!rows.some(r=>r.ingredientId===i.id));if(next)setRows([...rows,{ingredientId:next.id,quantity:''}]);}}>Thêm dòng {category==='supplies'?'vật dụng':'nguyên liệu'}</button>
    <label>Ghi chú phiếu nhập<textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <p>Tạo phiếu chưa cộng tồn. Kiểm tra phiếu và xác nhận nhập hàng ở danh sách bên dưới.</p><button className="button" type="submit">Tạo phiếu nhập</button></fieldset>{error&&<p role="alert">{error}</p>}</form>;
}
export function CountForm({items,busy,submit,recount,cancel}:{items:Ingredient[];busy:boolean;submit:Submit;recount:IngredientCount|null;cancel:()=>void}) {
  const [values,setValues]=useState<Record<string,{selected:boolean;actual:string;note:string}>>({}),[note,setNote]=useState(''),[error,setError]=useState('');
  const available=recount?items.filter(i=>recount.lines.some(l=>l.ingredient.id===i.id)):items;
  const value=(i:Ingredient)=>values[i.id]??{selected:!!recount,actual:'',note:''};
  function update(i:Ingredient,patch:Partial<ReturnType<typeof value>>){setValues({...values,[i.id]:{...value(i),...patch}});}
  function save(e:FormEvent){e.preventDefault();const lines=available.filter(i=>value(i).selected).map(i=>({ingredientId:i.id,expectedVersion:i.version,actualQuantity:normalizeQuantity(value(i).actual,i.unit),note:value(i).note}));
    if(!lines.length||lines.length>50||lines.some(l=>l.actualQuantity===null)||(recount&&lines.length!==recount.lines.length)){setError('Chọn 1–50 nguyên liệu và nhập số lượng thực tế không âm cho từng dòng.');return;}setError('');submit('counts',{note,lines,...(recount?{recountOfId:recount.id}:{})});}
  return <form className="ingredient-card ingredient-form" onSubmit={save}><h2>{recount?'Kiểm kê lại theo yêu cầu':'Gửi phiếu kiểm kê'}</h2><p>Nhập số lượng đếm thực tế. Tồn chính thức chỉ thay đổi khi Admin phê duyệt; không điền 0 nếu chưa kiểm kê.</p>
    {recount&&<p>Lý do kiểm kê lại: {recount.reviewNote}</p>}<fieldset disabled={busy||!available.length}><legend>Kết quả kiểm kê nguyên liệu</legend>
    {available.map(i=>{const v=value(i),actual=normalizeQuantity(v.actual,i.unit);return <div key={i.id} className="ingredient-entry">
      <label className="ingredient-check"><input type="checkbox" checked={v.selected} disabled={!!recount} onChange={e=>update(i,{selected:e.target.checked})}/>{i.name} ({unitLabels[i.unit]})</label>
      <p>Tồn hệ thống: {displayQuantity(i.quantity)} {unitLabels[i.unit]}</p>
      {v.selected&&<><label>Số lượng thực tế — {i.name}<input inputMode="decimal" value={v.actual} required onChange={e=>update(i,{actual:e.target.value})}/></label>
        <p role="status">Chênh lệch: {actual===null?'Chưa nhập hợp lệ':`${displayQuantity(quantityDifference(actual,i.quantity))} ${unitLabels[i.unit]}`}</p>
        <label>Nguyên nhân chênh lệch — {i.name}<textarea maxLength={500} value={v.note} onChange={e=>update(i,{note:e.target.value})}/></label></>}
    </div>;})}
    <label>Ghi chú chung<textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label><button className="button" type="submit">Gửi Admin phê duyệt</button>
    {recount&&<button type="button" onClick={cancel}>Hủy thao tác kiểm kê lại</button>}</fieldset>{error&&<p role="alert">{error}</p>}</form>;
}
export function ConfirmReceipt({doc,busy,submit}:{doc:IngredientReceipt;busy:boolean;submit:Submit}) {
  const [confirmed,setConfirmed]=useState(false);
  return <div className="ingredient-document-actions"><label className="ingredient-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Đã kiểm tra số lượng thực nhận của phiếu này</label>
    <button className="button" disabled={busy||!confirmed} onClick={()=>submit(`receipts/${doc.id}/confirm`,{expectedVersion:doc.version})}>Xác nhận nhập hàng</button></div>;
}
export function ReviewCount({doc,busy,submit}:{doc:IngredientCount;busy:boolean;submit:Submit}) {
  const [note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),stale=doc.lines.some(l=>l.stale);
  return <fieldset className="ingredient-document-actions" disabled={busy}><legend>Phê duyệt kiểm kê</legend>
    {stale&&<p role="alert">Tồn kho đã thay đổi. Cần yêu cầu Staff kiểm kê lại; phiếu này không thể ghi đè tồn hiện tại.</p>}
    <label>Lý do / ghi chú xử lý<textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <label className="ingredient-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Đã đối chiếu số lượng thực tế</label>
    <div className="ingredient-actions"><button className="button" disabled={stale||!confirmed} onClick={()=>submit(`counts/${doc.id}/review`,{action:'APPROVE',expectedVersion:doc.version,note})}>Phê duyệt kiểm kê</button>
      <button disabled={!note.trim()} onClick={()=>submit(`counts/${doc.id}/review`,{action:'REJECT',expectedVersion:doc.version,note})}>Từ chối</button>
      <button disabled={!note.trim()} onClick={()=>submit(`counts/${doc.id}/review`,{action:'REQUEST_RECOUNT',expectedVersion:doc.version,note})}>Yêu cầu kiểm kê lại</button></div></fieldset>;
}

'use client';
import { useState, type FormEvent } from 'react';
import { ingredientName, listedIngredients, normalizeQuantity, supportsInventoryCount, unitLabels } from '../lib/api/ingredients';
import type { Ingredient } from '../types/ingredient';

export function InventoryControlForm({items,busy,submit}:{items:Ingredient[];busy:boolean;submit:(path:string,body:object)=>void}) {
  const listed=listedIngredients(items).filter(supportsInventoryCount),[selected,setSelected]=useState('');
  const ingredient=listed.find(i=>i.id===selected)??listed[0];
  return <section className="ingredient-card ingredient-form"><h2>Ngưỡng chênh lệch nguyên liệu</h2>
    <p>Chỉ áp dụng nguyên liệu; không tính chênh lệch đá viên, nước lọc hoặc vật dụng. Ngưỡng không tự phê duyệt phiếu.</p>
    <label>Mặt hàng<select value={ingredient?.id??''} disabled={busy} onChange={e=>setSelected(e.target.value)}>{listed.map(i=><option key={i.id} value={i.id}>{ingredientName(i)} ({unitLabels[i.unit]})</option>)}</select></label>
    {ingredient&&<ControlFields key={`${ingredient.id}:${ingredient.version}`} ingredient={ingredient} busy={busy} submit={submit}/>}
  </section>;
}
function ControlFields({ingredient:i,busy,submit}:{ingredient:Ingredient;busy:boolean;submit:(path:string,body:object)=>void}) {
  const [error,setError]=useState('');
  function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const data=new FormData(e.currentTarget),percent=String(data.get('percent')??'').trim().replace(',','.'),absolute=String(data.get('absolute')??'').trim();
    const normalizedAbsolute=absolute?normalizeQuantity(absolute,i.unit):null;
    if((percent&&(!/^(0|[1-9]\d{0,3})(\.\d{1,3})?$/.test(percent)||Number(percent)>1000))||(absolute&&normalizedAbsolute===null)){setError('Kiểm tra ngưỡng không âm, tối đa 3 chữ số lẻ và đúng đơn vị nguyên liệu.');return;}
    setError('');submit(`ingredients/${i.id}/control`,{expectedVersion:i.version,variancePercentThreshold:percent||null,varianceAbsoluteThreshold:normalizedAbsolute});
  }
  return <form onSubmit={save}><fieldset disabled={busy}><legend>{ingredientName(i)}</legend>
    <label>Ngưỡng tỷ lệ chênh lệch (%)<input name="percent" inputMode="decimal" defaultValue={i.variancePercentThreshold??''} placeholder="Chưa cấu hình"/></label>
    <label>Ngưỡng chênh lệch tuyệt đối ({unitLabels[i.unit]})<input name="absolute" inputMode="decimal" defaultValue={i.varianceAbsoluteThreshold??''} placeholder="Chưa cấu hình"/></label>
    <p>Tỷ lệ tính trên tiêu hao lý thuyết trong ngày; khi không có tiêu hao, dùng ngưỡng tuyệt đối. Bỏ trống ngưỡng sẽ giữ chênh lệch ở trạng thái chưa cấu hình.</p>
    <button type="submit" className="button">Lưu ngưỡng cho mặt hàng</button>
  </fieldset>{error&&<p role="alert">{error}</p>}</form>;
}

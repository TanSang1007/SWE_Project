'use client';
import { getProducts } from '../lib/api/products';
import { useCatalog } from './use-catalog';

export function DrinkStockAlerts() {
  const {state,retry}=useCatalog(getProducts);
  if(state.status==='loading')return <p role="status">Đang kiểm tra trạng thái món theo size…</p>;
  if(state.status==='error')return <p role="alert">Chưa tải được trạng thái món. <button onClick={retry}>Tải lại trạng thái món</button></p>;
  const alerts=state.data.items.flatMap(product=>(product.sizeAvailability??[]).filter(size=>size.stockStatus!=='IN_STOCK').map(size=>({...size,name:product.name})));
  return <section className="ingredient-card"><h2>Món cần theo dõi nguyên liệu</h2><p>Khả dụng sau khi trừ phần đã giữ. Cảnh báo nhập hàng của nguyên liệu được tính riêng.</p>
    {alerts.length?<ul>{alerts.map(item=><li key={`${item.name}:${item.size}`}><strong>{item.name} · Size {item.size}</strong>: {item.stockStatus==='LOW_STOCK'?`Sắp hết món · còn ${item.maxQuantity} ly`:'Hết món'}</li>)}</ul>:<p>Các size đang bán đều đủ nguyên liệu cho trên 10 ly, hoặc chưa có món áp dụng công thức.</p>}
  </section>;
}

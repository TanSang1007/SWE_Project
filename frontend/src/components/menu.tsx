'use client';
import Link from 'next/link';
import { getProducts } from '../lib/api/products';
import { formatVnd } from '../lib/money';
import type { ProductList } from '../types/catalog';
import { ProductImage } from './product-image';
import { CatalogLoading, CatalogState } from './catalog-state';
import { useCatalog } from './use-catalog';
export function ProductListView({ catalog }: { catalog: ProductList }) {
  if (!catalog.items.length) return <CatalogState kind="empty" />;
  return <section aria-labelledby="menu-heading" className="menu-section"><div className="section-heading"><h2 id="menu-heading">Thực đơn hôm nay</h2><span>{catalog.items.length} đồ uống</span></div>
    <ul className="product-grid">{catalog.items.map((product) => <li key={product.id} className="product-card"><div className="card-image"><ProductImage src={product.imageUrl} name={product.name} />
      <span className={`availability ${product.available ? '' : 'sold-out'}`}>{product.available ? 'Còn món' : 'Tạm hết'}</span></div>
      <div className="card-content"><h3>{product.name}</h3><p className="price">{formatVnd(product.price)}</p>
        <Link className="detail-link" href={`/products/${product.id}`} aria-label={`Xem chi tiết ${product.name}`}>Xem chi tiết <span aria-hidden="true">↗</span></Link></div></li>)}</ul></section>;
}
export function Menu() {
  const { state, retry } = useCatalog(getProducts);
  return <><section className="hero"><div><p className="eyebrow">Một chút nhẹ nhàng, mỗi ngày</p><h1>Chọn một ly.<br /><em>Chậm lại một chút.</em></h1>
    <p>Khám phá thực đơn BrewLite, xem kích cỡ và topping cho món bạn yêu thích.</p></div><div className="hero-stamp" aria-hidden="true"><span>BREW<br />LITE</span><small>thưởng thức từng chút</small></div></section>
    {state.status === 'loading' && <CatalogLoading />}{state.status === 'error' && <CatalogState kind={state.kind} retry={retry} />}
    {state.status === 'ready' && <ProductListView catalog={state.data} />}</>;
}

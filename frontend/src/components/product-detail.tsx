'use client';
import Link from 'next/link';
import { useCallback } from 'react';
import { getProductById } from '../lib/api/products';
import { formatVnd } from '../lib/money';
import type { ProductDetail as Detail } from '../types/catalog';
import { ProductImage } from './product-image';
import { CatalogLoading, CatalogState } from './catalog-state';
import { useCatalog } from './use-catalog';
import { AddToCart } from './add-to-cart';
export function ProductDetailView({ product }: { product: Detail }) {
  return <article className="product-detail"><div className="detail-image"><ProductImage src={product.imageUrl} name={product.name} /></div>
    <div className="detail-content"><p className="eyebrow">Thực đơn BrewLite</p><h1>{product.name}</h1><span className={`availability inline ${product.available ? '' : 'sold-out'}`}>{product.available ? 'Còn món' : 'Tạm hết'}</span>
      {!product.available && <p role="status">Hiện chưa thể đặt món này. Món có thể hết hàng hoặc chưa có kích cỡ hợp lệ.</p>}
      <dl className="base-price"><dt>Giá cơ bản</dt><dd>{formatVnd(product.price)}</dd></dl>
      <section aria-labelledby="sizes-heading"><h2 id="sizes-heading">Kích cỡ</h2><p className="section-note">Phụ thu theo kích cỡ của món.</p>
        {product.sizes.length ? <ul className="size-list">{product.sizes.map((size) => <li key={size.size}><span>Size {size.size}</span><strong>+{formatVnd(size.extraPrice)}</strong></li>)}</ul> : <p>Chưa có kích cỡ cho món này.</p>}</section>
      <section aria-labelledby="toppings-heading"><h2 id="toppings-heading">Topping</h2><p className="section-note">Các topping có thể dùng cùng món này.</p>
        {product.toppings.length ? <ul className="topping-list">{product.toppings.map((topping) => <li key={topping.id}><span>{topping.name}</span><strong>+{formatVnd(topping.price)}</strong></li>)}</ul> : <p>Món này chưa có topping đi kèm.</p>}</section>
      <AddToCart key={product.id} product={product} />
    </div></article>;
}
export function ProductDetail({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => getProductById(id, signal), [id]); const { state, retry } = useCatalog(load);
  return <><Link href="/" className="back-link">← Về thực đơn</Link>{state.status === 'loading' && <CatalogLoading detail />}
    {state.status !== 'ready' && <h1 className="sr-only">Chi tiết đồ uống</h1>}
    {state.status === 'error' && <CatalogState kind={state.kind} retry={state.kind === 'unavailable' ? retry : undefined} />}
    {state.status === 'ready' && <ProductDetailView product={state.data} />}</>;
}

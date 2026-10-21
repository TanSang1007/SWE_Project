import { getApiBaseUrl } from '../env';
import type { Product, ProductDetail, ProductList } from '../../types/catalog';

export class CatalogError extends Error {
  constructor(public readonly kind: 'invalid-id' | 'not-found' | 'unavailable') { super(kind); this.name = 'CatalogError'; }
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CatalogError('unavailable');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new CatalogError('unavailable');
  return value;
}
function money(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})$/.test(value)) throw new CatalogError('unavailable');
  return value;
}
export function isProductId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function product(value: unknown): Product {
  const data = record(value); const id = text(data.id);
  if (!isProductId(id) || typeof data.available !== 'boolean') throw new CatalogError('unavailable');
  const imageUrl = text(data.imageUrl);
  if (!imageUrl.startsWith('/images/') || imageUrl.includes('..')) throw new CatalogError('unavailable');
  return { id, name: text(data.name), price: money(data.price), imageUrl, available: data.available };
}
export function parseProducts(value: unknown): ProductList {
  const data = record(value);
  if (!Array.isArray(data.items) || data.currency !== 'VND') throw new CatalogError('unavailable');
  return { items: data.items.map(product), currency: 'VND' };
}
export function parseProduct(value: unknown): ProductDetail {
  const data = record(value);
  if (!Array.isArray(data.sizes) || !Array.isArray(data.toppings)) throw new CatalogError('unavailable');
  return { ...product(data), sizes: data.sizes.map((value: unknown) => {
    const size = record(value); const name = text(size.size);
    if (!['S', 'M', 'L'].includes(name)) throw new CatalogError('unavailable');
    return { size: name, extraPrice: money(size.extraPrice) };
  }), toppings: data.toppings.map((value: unknown) => {
    const topping = record(value); const id = text(topping.id);
    if (!isProductId(id)) throw new CatalogError('unavailable');
    return { id, name: text(topping.name), price: money(topping.price) };
  }) };
}
async function read(path: string, signal?: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, { signal, cache: 'no-store', credentials: 'omit' });
    if (response.status === 404) throw new CatalogError('not-found');
    if (response.status === 400) throw new CatalogError('invalid-id');
    if (!response.ok) throw new CatalogError('unavailable');
    return await response.json() as unknown;
  } catch (error) {
    if (error instanceof CatalogError || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new CatalogError('unavailable');
  }
}
export async function getProducts(signal?: AbortSignal): Promise<ProductList> { return parseProducts(await read('/products', signal)); }
export async function getProductById(id: string, signal?: AbortSignal): Promise<ProductDetail> {
  if (!isProductId(id)) throw new CatalogError('invalid-id');
  return parseProduct(await read(`/products/${encodeURIComponent(id)}`, signal));
}

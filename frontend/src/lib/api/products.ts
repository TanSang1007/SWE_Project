import { getApiBaseUrl } from '../env';
import type { Product, ProductDetail, ProductList } from '../../types/catalog';
import type { DrinkStockStatus } from '../../types/catalog';

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
function stockStatus(value: unknown): DrinkStockStatus | undefined {
  if (value === undefined) return undefined;
  if (value !== 'OUT_OF_STOCK' && value !== 'LOW_STOCK' && value !== 'IN_STOCK') throw new CatalogError('unavailable');
  return value;
}
export function isProductId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
// Stored topping identities may use older sequence IDs. This predicate is
// separate from Product URL and purchase input validation.
export function isToppingReferenceId(value: string): boolean {
  return isProductId(value) || /^[1-9]\d{0,19}$/.test(value);
}
function product(value: unknown): Product {
  const data = record(value); const id = text(data.id);
  if (!isProductId(id) || typeof data.available !== 'boolean') throw new CatalogError('unavailable');
  const imageUrl = text(data.imageUrl);
  if (!imageUrl.startsWith('/images/') || imageUrl.includes('..')) throw new CatalogError('unavailable');
  const status = stockStatus(data.stockStatus);
  let sizeAvailability;
  if (data.sizeAvailability !== undefined) {
    if (!Array.isArray(data.sizeAvailability)) throw new CatalogError('unavailable');
    sizeAvailability = data.sizeAvailability.map((value: unknown) => {
      const item=record(value),size=text(item.size),status=stockStatus(item.stockStatus);
      if (!['S','M','L'].includes(size)||!Number.isSafeInteger(item.maxQuantity)||Number(item.maxQuantity)<0||!status) throw new CatalogError('unavailable');
      return {size,maxQuantity:Number(item.maxQuantity),stockStatus:status};
    });
    if (new Set(sizeAvailability.map(s=>s.size)).size!==sizeAvailability.length) throw new CatalogError('unavailable');
  }
  return { id, name: text(data.name), price: money(data.price), imageUrl, available: data.available, ...(status ? { stockStatus: status } : {}), ...(sizeAvailability ? {sizeAvailability} : {}) };
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
    if (size.available !== undefined && typeof size.available !== 'boolean' || size.maxQuantity !== undefined && (!Number.isSafeInteger(size.maxQuantity) || Number(size.maxQuantity) < 0)) throw new CatalogError('unavailable');
    const status = stockStatus(size.stockStatus);
    return { size: name, extraPrice: money(size.extraPrice), ...(size.available === undefined ? {} : { available: size.available as boolean }), ...(size.maxQuantity === undefined ? {} : { maxQuantity: size.maxQuantity as number }), ...(status ? { stockStatus: status } : {}) };
  }), toppings: data.toppings.map((value: unknown) => {
    const topping = record(value); const id = text(topping.id);
    if (!isToppingReferenceId(id)) throw new CatalogError('unavailable');
    if (topping.availableSizes !== undefined && (!Array.isArray(topping.availableSizes) || topping.availableSizes.some(size => !['S','M','L'].includes(String(size))))) throw new CatalogError('unavailable');
    return { id, name: text(topping.name), price: money(topping.price), ...(topping.availableSizes === undefined ? {} : { availableSizes: topping.availableSizes as string[] }) };
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

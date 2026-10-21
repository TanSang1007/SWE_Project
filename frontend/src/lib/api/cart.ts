import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import type { Cart, CartInput, CartItem } from '../../types/cart';
export class CartError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export async function cartRequest(method = 'GET', path = '/cart', body?: CartInput | { qty: number }): Promise<Cart> {
  const token = getAccessToken(); if (!token) throw new CartError('UNAUTHORIZED');
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, { method, cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 401) {
      if (useAuthStore.getState().accessToken === token) useAuthStore.getState().clear();
      throw new CartError('UNAUTHORIZED');
    }
    const value = await response.json();
    if (!response.ok) {
      const id = value?.error?.details?.existingOrderId;
      if (value?.error?.code === 'INVALID_ORDER_STATE' && typeof window !== 'undefined' && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) {
        window.dispatchEvent(new CustomEvent('brewlite-unpaid-order', { detail: id }));
      }
      throw new CartError(value?.error?.code ?? 'UNAVAILABLE');
    }
    return parseCart(value);
  } catch (error) { if (error instanceof CartError) throw error; throw new CartError('UNAVAILABLE'); }
}
export function parseCart(value: unknown): Cart {
  const validMoney = (v: unknown) => typeof v === 'string' && /^(0|[1-9]\d{0,11})$/.test(v);
  if (typeof value !== 'object' || value === null) throw new CartError('UNAVAILABLE');
  const data = value as Cart;
  if (data.currency !== 'VND' || !validMoney(data.subtotal) || !Array.isArray(data.items)
    || !Number.isInteger(data.totalQuantity) || data.totalQuantity < 0) throw new CartError('UNAVAILABLE');
  for (const item of data.items) {
    if (!item || typeof item.id !== 'string' || typeof item.productId !== 'string' || typeof item.productName !== 'string'
      || typeof item.size !== 'string' || typeof item.imageUrl !== 'string' || typeof item.available !== 'boolean'
      || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99 || !validMoney(item.unitPrice) || !validMoney(item.lineTotal)
      || !Array.isArray(item.toppings) || item.toppings.some((t) => !t || typeof t.id !== 'string' || typeof t.name !== 'string' || !validMoney(t.price))) throw new CartError('UNAVAILABLE');
  }
  return data;
}
export function sameConfiguration(old: CartItem, input: CartInput): boolean {
  return old.productId === input.productId && old.size === input.size
    && old.toppings.map((t) => t.id.toLowerCase()).sort().join(':') === input.toppingIds.map((id) => id.toLowerCase()).sort().join(':');
}
// Never delete old data until the add has a confirmed successful response.
export async function editCartItem(old: CartItem, input: CartInput): Promise<{ cart: Cart; pendingDelete?: string }> {
  const token = getAccessToken();
  if (sameConfiguration(old, input)) return { cart: await cartRequest() };
  const added = await cartRequest('POST', '/cart/items', { ...input, qty: old.qty });
  if (getAccessToken() !== token) throw new CartError('UNAUTHORIZED');
  try { return { cart: await cartRequest('DELETE', `/cart/items/${old.id}`) }; }
  catch { return { cart: added, pendingDelete: old.id }; }
}
export function cartErrorMessage(error: unknown): string {
  const code = error instanceof CartError ? error.code : 'UNAVAILABLE';
  if (code === 'UNAUTHORIZED') return 'Vui lòng đăng nhập để xem và chỉnh sửa giỏ.';
  if (code === 'INVALID_ORDER_STATE') return 'Bạn đang có đơn chưa hoàn tất. Hãy mở hoặc hủy đơn trước khi chỉnh sửa giỏ.';
  if (code === 'OUT_OF_STOCK') return 'Món đang tạm hết. Giỏ của bạn vẫn được giữ.';
  if (code === 'PRODUCT_UNAVAILABLE') return 'Món đã ngừng bán. Giỏ vẫn được giữ; hãy điều chỉnh hoặc xóa dòng này.';
  if (code === 'VALIDATION_ERROR') return 'Giỏ vượt giới hạn: tối đa 50 dòng, 99 ly mỗi cấu hình và 10 topping.';
  if (code === 'INVALID_ITEM_OPTIONS') return 'Tùy chọn không còn hợp lệ. Vui lòng chọn lại.';
  return 'Chưa xác nhận được thao tác. Kiểm tra giỏ trước khi thử lại để tránh thêm hai lần.';
}

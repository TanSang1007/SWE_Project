import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import { isProductId } from './products';
import type { AdminSize, AdminTopping, AssociationList, SizeList } from '../../types/admin-option';
export class OptionError extends Error { constructor(public readonly code: string) { super(code); } }
export const validOptionMoney = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d{0,11})$/.test(value);
const version = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2147483647;
const fail = () => new OptionError('UNAVAILABLE');
export function parseTopping(value: unknown): AdminTopping {
  const t = value as AdminTopping;
  if (!t || typeof t.id !== 'string' || !isProductId(t.id) || typeof t.name !== 'string' || !t.name.trim() || !validOptionMoney(t.price) || typeof t.isActive !== 'boolean' || !version(t.version)
    || typeof t.createdAt !== 'string' || !Number.isFinite(Date.parse(t.createdAt)) || typeof t.updatedAt !== 'string' || !Number.isFinite(Date.parse(t.updatedAt))) throw fail();
  return { id: t.id, name: t.name, price: t.price, isActive: t.isActive, version: t.version, createdAt: t.createdAt, updatedAt: t.updatedAt };
}
export function parseToppings(value: unknown): AdminTopping[] {
  const rows = value as { items?: unknown }; if (!rows || !Array.isArray(rows.items)) throw fail(); const items = rows.items.map(parseTopping);
  if (new Set(items.map(t => t.id)).size !== items.length) throw fail(); return items;
}
export function parseSizes(value: unknown, id: string): SizeList {
  const list = value as SizeList; if (!list || !Array.isArray(list.items) || !version(list.productVersion)) throw fail();
  const items = list.items.map((s): AdminSize => { if (!s || s.productId !== id || !['S', 'M', 'L'].includes(s.size) || !validOptionMoney(s.extraPrice) || typeof s.isActive !== 'boolean') throw fail();
    return { productId: s.productId, size: s.size, extraPrice: s.extraPrice, isActive: s.isActive }; });
  if (new Set(items.map(s => s.size)).size !== items.length) throw fail(); return { items, productVersion: list.productVersion };
}
export function parseAssociations(value: unknown): AssociationList { const v = value as AssociationList; if (!v || !version(v.productVersion)) throw fail(); return { items: parseToppings(v), productVersion: v.productVersion }; }
export async function optionRequest(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: object, signal?: AbortSignal): Promise<unknown> {
  const token = getAccessToken(); const user = useAuthStore.getState().user;
  if (!token || !user) throw new OptionError('UNAUTHORIZED'); if (user.role !== 'ADMIN') throw new OptionError('FORBIDDEN');
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  if (!new RegExp(`^/admin/(?:toppings(?:/${uuid})?|products/${uuid}/(?:sizes(?:/[SML])?|toppings(?:/${uuid})?))$`).test(path)) throw new OptionError('VALIDATION_ERROR');
  const current = () => { const s = useAuthStore.getState(); return s.accessToken === token && s.user?.id === user.id && s.user.role === user.role; };
  try {
    const timeout = AbortSignal.timeout(5000); const r = await fetch(getApiBaseUrl() + path, { method, cache: 'no-store', credentials: 'omit', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!current()) throw new OptionError('UNAUTHORIZED');
    if (r.status === 401) { useAuthStore.getState().clear(); throw new OptionError('UNAUTHORIZED'); } if (r.status === 403) throw new OptionError('FORBIDDEN');
    if (r.status === 204 && method === 'DELETE') return undefined;
    const value: unknown = await r.json(); if (!current()) throw new OptionError('UNAUTHORIZED');
    if (!r.ok) { const code = (value as { error?: { code?: unknown } })?.error?.code;
      throw new OptionError(typeof code === 'string' && ['CONCURRENT_UPDATE', 'RESOURCE_IN_USE', 'RESOURCE_ALREADY_EXISTS', 'VALIDATION_ERROR', 'PRODUCT_NOT_FOUND', 'SIZE_NOT_FOUND', 'TOPPING_NOT_FOUND'].includes(code) ? code : 'UNAVAILABLE'); }
    if (r.status !== (method === 'POST' ? 201 : 200)) throw fail(); return value;
  } catch (e) { if (e instanceof OptionError) throw e; throw fail(); }
}
export const getSizes = async (id: string, signal?: AbortSignal) => parseSizes(await optionRequest('GET', `/admin/products/${id}/sizes`, undefined, signal), id);
export const getAssociations = async (id: string, signal?: AbortSignal) => parseAssociations(await optionRequest('GET', `/admin/products/${id}/toppings`, undefined, signal));
export const getToppings = async (signal?: AbortSignal) => parseToppings(await optionRequest('GET', '/admin/toppings', undefined, signal));
export const getTopping = async (id: string, signal?: AbortSignal) => { const t = parseTopping(await optionRequest('GET', `/admin/toppings/${id}`, undefined, signal)); if (t.id !== id) throw fail(); return t; };
export function optionMessage(code: string) {
  if (code === 'UNAUTHORIZED') return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (code === 'FORBIDDEN') return 'Không có quyền quản lý tùy chọn.';
  if (code === 'CONCURRENT_UPDATE') return 'Dữ liệu đã thay đổi. Tải lại và kiểm tra trước khi xác nhận thao tác mới.';
  if (code === 'RESOURCE_IN_USE') return 'Cấu hình đang được giỏ hoặc lịch sử đơn sử dụng, hoặc là kích cỡ bắt buộc. Không thể xóa hoặc ngừng cung cấp cấu hình này.';
  if (code === 'RESOURCE_ALREADY_EXISTS') return 'Kích cỡ hoặc liên kết đã tồn tại.';
  if (code === 'VALIDATION_ERROR') return 'Kiểm tra tên, giá nguyên đồng và các trường bắt buộc.';
  if (['PRODUCT_NOT_FOUND', 'SIZE_NOT_FOUND', 'TOPPING_NOT_FOUND'].includes(code)) return 'Không tìm thấy cấu hình. Hãy tải lại dữ liệu.';
  return 'Chưa xác nhận được kết quả. Chỉ tải lại và kiểm tra dữ liệu; không tự gửi lại thao tác.';
}

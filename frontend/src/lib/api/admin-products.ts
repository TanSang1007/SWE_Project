import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import { isProductId } from './products';
import type { AdminProduct, ProductCreate, ProductUpdate } from '../../types/admin-product';
export class ProductManagementError extends Error { constructor(public readonly code: string) { super(code); } }
const fail = () => new ProductManagementError('UNAVAILABLE');
const money = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,11})$/.test(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2147483647;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function parseAdminProduct(value: unknown): AdminProduct {
  if (!value || typeof value !== 'object') throw fail(); const p = value as AdminProduct;
  if (typeof p.id !== 'string' || !isProductId(p.id) || typeof p.name !== 'string' || !p.name.trim() || !money(p.price)
    || typeof p.imageUrl !== 'string' || !p.imageUrl.startsWith('/images/') || p.imageUrl.includes('..') || !integer(p.stock) || !integer(p.version)
    || typeof p.isActive !== 'boolean' || !date(p.createdAt) || !date(p.updatedAt) || !Array.isArray(p.sizes) || !Array.isArray(p.toppings)) throw fail();
  const sizes = p.sizes.map(s => { if (!s || !['S', 'M', 'L'].includes(s.size) || !money(s.extraPrice)) throw fail(); return { size: s.size, extraPrice: s.extraPrice }; });
  const toppings = p.toppings.map(t => { if (!t || typeof t.id !== 'string' || !isProductId(t.id) || typeof t.name !== 'string' || !money(t.price) || !date(t.createdAt) || !date(t.updatedAt)) throw fail();
    return { id: t.id, name: t.name, price: t.price, createdAt: t.createdAt, updatedAt: t.updatedAt }; });
  if (new Set(sizes.map(s => s.size)).size !== sizes.length || new Set(toppings.map(t => t.id)).size !== toppings.length) throw fail();
  return { id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, stock: p.stock, isActive: p.isActive, version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt, sizes, toppings };
}
export function parseAdminProducts(value: unknown): AdminProduct[] {
  const list = value as { items?: unknown }; if (!list || !Array.isArray(list.items)) throw fail();
  const rows = list.items.map(parseAdminProduct); if (new Set(rows.map(p => p.id)).size !== rows.length) throw fail(); return rows;
}
export async function adminProductRequest(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', id?: string, body?: ProductCreate | ProductUpdate | { expectedVersion: number }, signal?: AbortSignal): Promise<unknown> {
  const token = getAccessToken(); const user = useAuthStore.getState().user;
  if (!token || !user) throw new ProductManagementError('UNAUTHORIZED');
  if (user.role !== 'ADMIN') throw new ProductManagementError('FORBIDDEN');
  if (id !== undefined && !isProductId(id)) throw new ProductManagementError('VALIDATION_ERROR');
  const current = () => { const s = useAuthStore.getState(); return s.accessToken === token && s.user?.id === user.id && s.user.role === user.role; };
  try {
    const timeout = AbortSignal.timeout(5000);
    const r = await fetch(`${getApiBaseUrl()}/admin/products${id ? '/' + id : ''}`, { method, cache: 'no-store', credentials: 'omit',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!current()) throw new ProductManagementError('UNAUTHORIZED');
    if (r.status === 401) { useAuthStore.getState().clear(); throw new ProductManagementError('UNAUTHORIZED'); }
    if (r.status === 403) throw new ProductManagementError('FORBIDDEN');
    if (r.status === 204 && method === 'DELETE') return undefined;
    const value: unknown = await r.json(); if (!current()) throw new ProductManagementError('UNAUTHORIZED');
    if (!r.ok) { const code = (value as { error?: { code?: unknown } })?.error?.code;
      throw new ProductManagementError(typeof code === 'string' && ['VALIDATION_ERROR', 'PRODUCT_NOT_FOUND', 'TOPPING_NOT_FOUND', 'RESOURCE_IN_USE', 'CONCURRENT_UPDATE'].includes(code) ? code : 'UNAVAILABLE'); }
    if (r.status !== (method === 'POST' ? 201 : 200)) throw fail();
    const parsed = method === 'GET' && !id ? parseAdminProducts(value) : parseAdminProduct(value);
    if (id && !Array.isArray(parsed) && parsed.id.toLowerCase() !== id.toLowerCase()) throw fail(); return parsed;
  } catch (error) { if (error instanceof ProductManagementError) throw error; throw fail(); }
}
export function productManagementMessage(code: string) {
  if (code === 'UNAUTHORIZED') return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (code === 'FORBIDDEN') return 'Không có quyền quản lý sản phẩm.';
  if (code === 'VALIDATION_ERROR') return 'Kiểm tra tên, giá nguyên đồng, ảnh và các tùy chọn bắt buộc.';
  if (code === 'PRODUCT_NOT_FOUND') return 'Không tìm thấy sản phẩm. Hãy tải lại danh sách.';
  if (code === 'TOPPING_NOT_FOUND') return 'Topping không còn tồn tại. Hãy kiểm tra lại lựa chọn.';
  if (code === 'RESOURCE_IN_USE') return 'Sản phẩm đang được sử dụng hoặc thiếu cấu hình bắt buộc. Có thể chọn ngừng bán thay vì xóa.';
  if (code === 'CONCURRENT_UPDATE') return 'Sản phẩm hoặc tồn kho đã thay đổi. Hãy xem dữ liệu mới và xác nhận một thao tác mới.';
  return 'Chưa xác nhận được kết quả. Hãy tải lại và kiểm tra danh sách trước thao tác mới; yêu cầu không được tự gửi lại.';
}
export function validateProductForm(name: string, price: string, imageUrl: string, sizes?: AdminProduct['sizes']): string {
  if (!name.trim() || name.trim().length > 120) return 'Tên sản phẩm phải có 1–120 ký tự.';
  if (!money(price)) return 'Giá phải là số nguyên đồng từ 0 đến 999999999999.';
  if (!/^\/images\/(?!.*\.\.)(?:(?!\.(?:\/|$))[A-Za-z0-9_.-]+\/)*(?!\.$)[A-Za-z0-9_.-]+$/.test(imageUrl) || imageUrl.length > 512) return 'Ảnh phải là đường dẫn hợp lệ trong /images/.';
  if (sizes && (!sizes.length || sizes.length > 3 || sizes.some(s => !['S', 'M', 'L'].includes(s.size) || !money(s.extraPrice)) || new Set(sizes.map(s => s.size)).size !== sizes.length)) return 'Chọn 1–3 kích cỡ S/M/L và phụ thu nguyên đồng hợp lệ.';
  return '';
}

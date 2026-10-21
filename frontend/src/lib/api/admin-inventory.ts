import { getApiBaseUrl } from '../env';
import { getAccessToken, useAuthStore } from '../auth-store';
import { isProductId } from './products';
import type { InventoryContext, InventoryItem, InventoryResult } from '../../types/admin-inventory';
export class InventoryError extends Error { constructor(public readonly code: string) { super(code); } }
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2147483647;
const fail = () => new InventoryError('UNAVAILABLE');
export function parseInventory(value: unknown): InventoryItem[] {
  const list = value as { items?: InventoryItem[] }; if (!list || !Array.isArray(list.items)) throw fail();
  const rows = list.items.map(p => {
    if (!p || !isProductId(p.productId) || typeof p.productName !== 'string' || !p.productName.trim() || !integer(p.stock) || !integer(p.version)) throw fail();
    return { productId: p.productId, productName: p.productName, stock: p.stock, version: p.version };
  });
  if (new Set(rows.map(p => p.productId)).size !== rows.length) throw fail(); return rows;
}
export function parseInventoryResult(value: unknown, context: InventoryContext): InventoryResult {
  const r = value as InventoryResult;
  if (!r || r.productId !== context.productId || r.delta !== context.body.delta || !integer(r.previousStock) || !integer(r.stock)
    || !integer(r.version) || r.version !== context.body.expectedVersion + 1 || r.stock !== r.previousStock + r.delta) throw fail();
  return { productId: r.productId, delta: r.delta, previousStock: r.previousStock, stock: r.stock, version: r.version };
}
async function request(context?: InventoryContext, signal?: AbortSignal): Promise<unknown> {
  const token = getAccessToken(), user = useAuthStore.getState().user;
  if (!token || !user || (context && context.userId !== user.id)) throw new InventoryError('UNAUTHORIZED');
  if (user.role !== 'ADMIN') throw new InventoryError('FORBIDDEN');
  const current = () => { const s = useAuthStore.getState(); return s.accessToken === token && s.user?.id === user.id && s.user.role === 'ADMIN'; };
  try {
    const timeout = AbortSignal.timeout(5000);
    const response = await fetch(getApiBaseUrl() + (context ? `/admin/products/${context.productId}/inventory-adjustments` : '/admin/inventory'), {
      method: context ? 'POST' : 'GET', cache: 'no-store', credentials: 'omit', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: `Bearer ${token}`, ...(context ? { 'Content-Type': 'application/json', 'Idempotency-Key': context.key } : {}) },
      ...(context ? { body: JSON.stringify(context.body) } : {}),
    });
    if (!current()) throw new InventoryError('UNAUTHORIZED');
    if (response.status === 401) { useAuthStore.getState().clear(); throw new InventoryError('UNAUTHORIZED'); }
    if (response.status === 403) throw new InventoryError('FORBIDDEN');
    const value: unknown = await response.json(); if (!current()) throw new InventoryError('UNAUTHORIZED');
    if (!response.ok) {
      const code = (value as { error?: { code?: unknown } })?.error?.code;
      const allowed = ['VALIDATION_ERROR', 'MISSING_IDEMPOTENCY_KEY', 'PRODUCT_NOT_FOUND', 'INVALID_STOCK_ADJUSTMENT', 'CONCURRENT_UPDATE', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_IN_PROGRESS', 'SERVICE_UNAVAILABLE'];
      throw new InventoryError(typeof code === 'string' && allowed.includes(code) ? code : 'UNAVAILABLE');
    }
    if (response.status !== 200) throw fail(); return value;
  } catch (e) { if (e instanceof InventoryError) throw e; throw fail(); }
}
export const getInventory = async (signal?: AbortSignal) => parseInventory(await request(undefined, signal));
export const adjustInventory = async (context: InventoryContext) => parseInventoryResult(await request(context), context);
export function inventoryPreview(stock: number, direction: string, quantity: string): { delta: number; stock: number } | null {
  if (!/^[1-9]\d{0,9}$/.test(quantity) || !['increase', 'decrease'].includes(direction)) return null;
  const n = Number(quantity); if (n > 2147483647) return null;
  const delta = direction === 'increase' ? n : -n, result = stock + delta;
  return integer(stock) && integer(result) ? { delta, stock: result } : null;
}
export function inventoryMessage(code: string) {
  if (code === 'CONCURRENT_UPDATE') return 'Tồn kho hoặc sản phẩm đã thay đổi. Tải lại dữ liệu rồi xác nhận một thao tác mới.';
  if (code === 'INVALID_STOCK_ADJUSTMENT') return 'Không đủ tồn để giảm hoặc kết quả vượt giới hạn số nguyên.';
  if (code === 'UNAUTHORIZED') return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (code === 'FORBIDDEN') return 'Không có quyền quản lý tồn kho.';
  if (code === 'PRODUCT_NOT_FOUND') return 'Sản phẩm không còn tồn tại. Hãy tải lại danh sách.';
  if (code === 'IDEMPOTENCY_KEY_REUSED') return 'Yêu cầu đã lưu không khớp khóa đã dùng. Không gửi một điều chỉnh mới; cần kiểm tra yêu cầu.';
  if (code === 'VALIDATION_ERROR' || code === 'MISSING_IDEMPOTENCY_KEY') return 'Kiểm tra số lượng nguyên khác 0 và phiên bản đã đọc.';
  return 'Chưa xác nhận được kết quả. Dùng Khôi phục yêu cầu để gửi lại đúng khóa và nội dung đã lưu.';
}

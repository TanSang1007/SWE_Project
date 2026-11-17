import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type IngredientUnit } from '../generated/prisma/client';
import { readIngredientCatalog } from './ingredient-catalog';
export const actorSelect = { id: true, email: true } as const;
export const stockChanged = () => new ConflictException({ code: 'INVENTORY_CHANGED', message: 'Tồn kho đã thay đổi. Tải lại và kiểm kê lại trước khi phê duyệt.' });
export const invalidState = () => new ConflictException({ code: 'INVALID_DOCUMENT_STATE', message: 'Phiếu không cho phép thao tác này.' });
export function quantity(value: string, unit: IngredientUnit, positive = false) {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(value)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Số lượng không hợp lệ.' });
  const q = new Prisma.Decimal(value);
  if ((positive && q.isZero()) || (['PIECE','EGG','BOTTLE','BAG'].includes(unit) && !q.isInteger())) throw new UnprocessableEntityException({ code: 'INVALID_QUANTITY', message: 'Lượng nhập phải dương; đơn vị cái, quả, chai và bao phải là số nguyên.' });
  return q;
}
export function uniqueLines(lines: { ingredientId: string }[]) {
  if (new Set(lines.map(l => l.ingredientId.toLowerCase())).size !== lines.length) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Nguyên liệu không được trùng trong một phiếu.' });
}
export function requestHash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function checkHash(stored: string, expected: string) {
  if (stored !== expected) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Mã yêu cầu đã dùng cho nội dung khác.' });
}
// I09 (người dùng chốt): mọi KG = 3, L = 2, bất kể tên nguyên liệu.
// List, SQL summary, frontend inventoryThresholds và CHECK trong migration
// 20261117000000_ingredient_unit_warning_thresholds phải giữ cùng quy tắc.
export function unitThreshold(unit: IngredientUnit) {
  return new Prisma.Decimal({PIECE:'10',L:'2',KG:'3',G:'10000',ML:'5000',EGG:'10',BOTTLE:'10',BAG:'5'}[unit]);
}
// KG/L values are retained only for replaying requests made before I09.
export const historicalIngredientThresholds: Record<string, string> = { 'bột ca cao|KG':'1', 'bột matcha|KG':'0.5', 'bột quế|KG':'0.1', 'cà phê|KG':'3', 'sữa tươi|L':'10', 'sữa đặc|L':'3', 'đường|KG':'5', 'sốt caramel|BOTTLE':'1', 'đá|BAG':'1' };
export function ingredientThreshold(name: string, unit: IngredientUnit) {
  if (unit === 'KG' || unit === 'L') return unitThreshold(unit);
  const normalizedName = name.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('vi');
  const entry = readIngredientCatalog().find(i => i.normalizedName === normalizedName && i.unit === unit);
  const threshold = entry?.lowStockThreshold ?? historicalIngredientThresholds[normalizedName + '|' + unit];
  return threshold === undefined ? unitThreshold(unit) : new Prisma.Decimal(threshold);
}
// q là lượng khả dụng (quantity - reservedQuantity), không phải tồn thực tế.
// KG/L: 0 là hết, dương dưới ngưỡng là sắp hết, bằng ngưỡng là còn hàng.
// inclusive chỉ giữ chính sách của một số đơn vị lịch sử ngoài KG/L.
export function stockStatus(q: Prisma.Decimal, threshold: Prisma.Decimal, inclusive = false) { return q.isZero() ? 'OUT_OF_STOCK' : (inclusive ? q.lte(threshold) : q.lt(threshold)) ? 'LOW_STOCK' : 'IN_STOCK'; }

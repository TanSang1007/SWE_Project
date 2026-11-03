import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type IngredientUnit } from '../generated/prisma/client';
export const actorSelect = { id: true, email: true } as const;
export const stockChanged = () => new ConflictException({ code: 'INVENTORY_CHANGED', message: 'Tồn kho đã thay đổi. Tải lại và kiểm kê lại trước khi phê duyệt.' });
export const invalidState = () => new ConflictException({ code: 'INVALID_DOCUMENT_STATE', message: 'Phiếu không cho phép thao tác này.' });
export function quantity(value: string, unit: IngredientUnit, positive = false) {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(value)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Số lượng không hợp lệ.' });
  const q = new Prisma.Decimal(value);
  if ((positive && q.isZero()) || (['PIECE','EGG'].includes(unit) && !q.isInteger())) throw new UnprocessableEntityException({ code: 'INVALID_QUANTITY', message: 'Lượng nhập phải dương; đơn vị cái và quả phải là số nguyên.' });
  return q;
}
export function uniqueLines(lines: { ingredientId: string }[]) {
  if (new Set(lines.map(l => l.ingredientId.toLowerCase())).size !== lines.length) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Nguyên liệu không được trùng trong một phiếu.' });
}
export function requestHash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function checkHash(stored: string, expected: string) {
  if (stored !== expected) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Mã yêu cầu đã dùng cho nội dung khác.' });
}
export function unitThreshold(unit: IngredientUnit) {
  return new Prisma.Decimal({PIECE:'10',L:'5',KG:'10',G:'10000',ML:'5000',EGG:'10'}[unit]);
}
export function stockStatus(q: Prisma.Decimal, threshold: Prisma.Decimal) { return q.isZero() ? 'OUT_OF_STOCK' : q.lt(threshold) ? 'LOW_STOCK' : 'IN_STOCK'; }

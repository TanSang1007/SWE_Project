import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

const materialName = (name: string) => name.trim().replace(/\s+/g,' ').normalize('NFC').toLocaleLowerCase('vi').replace(/ \(công thức\)$/,'');
export const isWaterMaterial = (name: string) => materialName(name) === 'nước lọc';
export const supportsInventoryCount = (item: {name:string;unit:string}) => item.unit !== 'PIECE' && !['đá','đá viên','nước lọc'].includes(materialName(item.name));

// Inventory counts are daily in Vietnam, independent of the server timezone.
export function inventoryDayStart(now: Date) {
  const offset = 7 * 60 * 60 * 1000;
  return new Date(Math.floor((now.getTime() + offset) / 86400000) * 86400000 - offset);
}

// I08: ngưỡng chênh lệch kiểm kê khác ngưỡng cảnh báo tồn I09; không tự gán.
// Có tiêu hao lý thuyết dương thì dùng tỷ lệ %, còn lại dùng độ lệch tuyệt đối.
export function countVariance(actual: Prisma.Decimal, system: Prisma.Decimal, consumption: Prisma.Decimal | null,
  percentThreshold: Prisma.Decimal | null, absoluteThreshold: Prisma.Decimal | null, unit?: string) {
  const difference = actual.minus(system), magnitude = difference.abs();
  const percent = unit !== 'PIECE' && consumption?.gt(0) ? magnitude.dividedBy(consumption).times(100) : null;
  const threshold = percent ? percentThreshold : absoluteThreshold;
  const measurement = percent ?? magnitude;
  return {
    difference: difference.toFixed(3),
    differenceKind: difference.isZero() ? 'MATCHED' : difference.isNegative() ? 'SHORTAGE' : 'SURPLUS',
    variancePercent: percent?.toFixed(3) ?? null,
    controlStatus: difference.isZero() ? 'MATCHED' : threshold === null ? 'UNCONFIGURED' : measurement.lte(threshold) ? 'WITHIN_THRESHOLD' : 'ABNORMAL',
  };
}

type JournalEntry = { sequence: bigint; beforeQuantity: Prisma.Decimal; afterQuantity: Prisma.Decimal; delta: Prisma.Decimal; countLineId: string | null };
// Duyệt chỉ cộng chênh lệch actual-system vào tồn HIỆN TẠI sau đối chiếu journal.
// Không ghi đè giao dịch nhập/tiêu hao mới, không trừ dưới reserved. Snapshot cũ
// thiếu movementSequence vẫn phải dùng version guard ở IngredientService.reviewCount.
export function reconciledCountQuantity(system: Prisma.Decimal, actual: Prisma.Decimal, current: Prisma.Decimal,
  reserved: Prisma.Decimal, movements: JournalEntry[]) {
  let balance = system;
  for (const movement of movements) {
    // A second count measures the same physical discrepancy; applying both
    // would double-adjust it, even when all movement arithmetic balances.
    if (movement.countLineId || !movement.beforeQuantity.equals(balance) || !movement.afterQuantity.equals(balance.plus(movement.delta))) {
      throw new ConflictException({ code: 'INVENTORY_CHANGED', message: 'Nhật ký cần được đối chiếu hoặc đã có kiểm kê khác. Yêu cầu kiểm kê lại.' });
    }
    balance = movement.afterQuantity;
  }
  const after = current.plus(actual.minus(system));
  if (!balance.equals(current) || after.lt(reserved) || after.isNegative() || after.gt('999999999.999')) {
    throw new ConflictException({ code: 'INVENTORY_CHANGED', message: 'Không thể điều chỉnh mà vẫn bảo toàn tồn và phần đã giữ. Cần kiểm kê lại.' });
  }
  return after;
}

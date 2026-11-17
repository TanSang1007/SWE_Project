import type { IngredientUnit } from "../generated/prisma/client";
// I01/I03: 18 mặt hàng hiện hành = 12 nguyên liệu + 6 vật dụng.
// Đây là danh mục hiển thị, không phải danh sách để xóa/seed lại database:
// 40 dòng lịch sử vẫn giữ nguyên. Đối chiếu normalizedName VÀ unit; chỉ đổi
// label khi muốn đổi tên trên UI, giữ suffix và identity mà snapshot đang dùng.
const recipeStorageName = (label: string) => `${label} (công thức)`;

export type IngredientCatalogEntry = {
  name: string;
  unit: IngredientUnit;
  label?: string;
  lowStockThreshold?: string;
};

// QUẢN LÝ VẬT TƯ TẠI ĐÂY:
// - Thêm dòng: Admin mở/tải lại kho để tạo mặt hàng còn thiếu với tồn 0.
// - Xóa dòng: ẩn khỏi kho và phiếu mới; vẫn giữ tồn/lịch sử trong database.
// - Đổi tên hiển thị: thêm/sửa label, giữ name và unit để dùng lại tồn cũ.
//   Ví dụ: { name: "Ly nhựa", label: "Ly nhựa và nắp", unit: "PIECE" }
// - PIECE = cái, L = lít, KG = kg, BOTTLE = chai, BAG = bao, EGG = quả. Không sửa tồn trong file này.
// nest --watch tự biên dịch khi lưu; launcher root npm run dev cần build/restart.
const supplies = ['Ly sứ', 'Ly thủy tinh lùn', 'Ly thủy tinh cao', 'Muỗng inox', 'Muỗng khuấy', 'Đĩa lót ly sứ'];
const materials: readonly [string, 'KG' | 'L'][] = [
  ['Cà phê hạt rang', 'KG'], ['Cà phê bột pha phin', 'KG'], ['Cà phê xay thô Cold Brew', 'KG'],
  ['Bột matcha', 'KG'], ['Bột cacao nguyên chất', 'KG'], ['Sữa tươi không đường', 'L'],
  ['Sữa đặc', 'KG'], ['Đường cát', 'KG'], ['Syrup đường', 'L'], ['Syrup caramel', 'L'],
  ['Kem tươi', 'L'], ['Đá viên', 'KG'],
];
// New identities start at zero. Labels match the supplied ingredient file;
// every old name/unit/quantity and document remains attached to its old row.
export const ingredientCatalog: readonly IngredientCatalogEntry[] = [
  ...supplies.map(label => ({ name: recipeStorageName(label), label, unit: 'PIECE' as const })),
  ...materials.map(([label, unit]) => ({ name: recipeStorageName(label), label, unit, lowStockThreshold: unit === 'L' ? '2' : '3' })),
];

export function readIngredientCatalog(
  catalog: readonly IngredientCatalogEntry[] = ingredientCatalog,
) {
  const names = new Set<string>();
  return catalog.map((entry) => {
    const name = entry.name.trim().replace(/\s+/g, " ").normalize("NFC");
    const normalizedName = name.toLocaleLowerCase("vi");
    const displayName = (entry.label ?? name).trim().normalize("NFC");
    if (
      !name ||
      name.length > 120 ||
      !displayName ||
      displayName.length > 120 ||
      !["PIECE", "L", "KG", "EGG", "BOTTLE", "BAG"].includes(entry.unit) ||
      names.has(normalizedName)
    ) {
      throw new Error(
        "Danh mục vật tư có tên/nhãn/đơn vị không hợp lệ hoặc tên bị trùng.",
      );
    }
    names.add(normalizedName);
    if (entry.lowStockThreshold !== undefined &&
      (!/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(entry.lowStockThreshold) ||
        (['PIECE','EGG','BOTTLE','BAG'].includes(entry.unit) && Number(entry.lowStockThreshold) % 1 !== 0))) {
      throw new Error('Ngưỡng cảnh báo vật tư không hợp lệ.');
    }
    return { name, normalizedName, unit: entry.unit, displayName,
      ...(entry.lowStockThreshold !== undefined ? { lowStockThreshold: entry.lowStockThreshold } : {}) };
  });
}

import type { IngredientUnit } from "../generated/prisma/client";

export type IngredientCatalogEntry = {
  name: string;
  unit: IngredientUnit;
  label?: string;
};

// QUẢN LÝ VẬT TƯ TẠI ĐÂY:
// - Thêm dòng: Admin mở/tải lại kho để tạo mặt hàng còn thiếu với tồn 0.
// - Xóa dòng: ẩn khỏi kho và phiếu mới; vẫn giữ tồn/lịch sử trong database.
// - Đổi tên hiển thị: thêm/sửa label, giữ name và unit để dùng lại tồn cũ.
//   Ví dụ: { name: "Ly nhựa", label: "Ly nhựa và nắp", unit: "PIECE" }
// - PIECE = cái, L = lít, KG = kg, EGG = quả. Không sửa tồn trong file này.
// nest --watch tự biên dịch khi lưu; launcher root npm run dev cần build/restart.
export const ingredientCatalog: readonly IngredientCatalogEntry[] = [
  { name: "Thìa nhựa", unit: "PIECE" },
  { name: "Ly nhựa", unit: "PIECE" },
  { name: "Ống hút", unit: "PIECE" },
  { name: "Bột phô mai", unit: "KG" },
  { name: "Trứng", unit: "EGG" },
  { name: "Bột ca cao", unit: "KG" },
  { name: "Bột màu thực phẩm", unit: "KG" },
  { name: "Thạch dừa", unit: "KG" },
  { name: "Phô mai viên", unit: "KG" },
  { name: "Sữa đặc", unit: "L" },
  { name: "Sữa tươi", unit: "L" },
  { name: "Đường", unit: "KG" },
  { name: "Cà phê", unit: "KG" },
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
      !["PIECE", "L", "KG", "EGG"].includes(entry.unit) ||
      names.has(normalizedName)
    ) {
      throw new Error(
        "Danh mục vật tư có tên/nhãn/đơn vị không hợp lệ hoặc tên bị trùng.",
      );
    }
    names.add(normalizedName);
    return { name, normalizedName, unit: entry.unit, displayName };
  });
}

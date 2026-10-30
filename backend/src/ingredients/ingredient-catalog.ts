import type { IngredientUnit } from "../generated/prisma/client";

// Real shop catalogue requested by the owner; opening quantities are not inferred.
export const ingredientCatalog: readonly {
  name: string;
  unit: IngredientUnit;
}[] = [
  { name: "Thìa nhựa", unit: "PIECE" },
  { name: "Ly và nắp nhựa", unit: "PIECE" },
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
];

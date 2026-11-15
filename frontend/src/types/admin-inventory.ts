export interface InventoryItem {
  productId: string; productName: string; stock: number; version: number;
  inventorySource?: 'INGREDIENTS'; available?: boolean; missingIngredients?: string[];
  ingredients?: { name: string; unit: string; quantity: string | null; available: boolean }[];
  sizes?: { size: string; cups: number; available: boolean; status: 'OUT_OF_STOCK'|'LOW_STOCK'|'IN_STOCK' }[];
}
export interface InventoryAdjustment { delta: number; expectedVersion: number }
export interface InventoryResult { productId: string; delta: number; previousStock: number; stock: number; version: number }
export interface InventoryContext { userId: string; productId: string; key: string; body: InventoryAdjustment }

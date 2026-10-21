export interface InventoryItem { productId: string; productName: string; stock: number; version: number }
export interface InventoryAdjustment { delta: number; expectedVersion: number }
export interface InventoryResult { productId: string; delta: number; previousStock: number; stock: number; version: number }
export interface InventoryContext { userId: string; productId: string; key: string; body: InventoryAdjustment }

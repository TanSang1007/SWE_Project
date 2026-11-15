export type DrinkStockStatus = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'IN_STOCK';
export interface Product { id: string; name: string; price: string; imageUrl: string; available: boolean; stockStatus?: DrinkStockStatus; sizeAvailability?: {size:string;maxQuantity:number;stockStatus:DrinkStockStatus}[] }
export interface ProductList { items: Product[]; currency: 'VND' }
export interface ProductDetail extends Product {
  sizes: { size: string; extraPrice: string; available?: boolean; maxQuantity?: number; stockStatus?: DrinkStockStatus }[];
  toppings: { id: string; name: string; price: string; availableSizes?: string[] }[];
}

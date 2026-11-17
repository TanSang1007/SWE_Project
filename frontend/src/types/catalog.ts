export interface SizeAvailability { size: string; available: boolean; maxQuantity: number }
export interface Product { id: string; name: string; price: string; imageUrl: string; available: boolean; sizeAvailability?: SizeAvailability[] }
export interface ProductList { items: Product[]; currency: 'VND' }
export interface ProductDetail extends Product {
  sizes: { size: string; extraPrice: string; available?: boolean; maxQuantity?: number }[];
  toppings: { id: string; name: string; price: string; availableSizes?: string[] }[];
}

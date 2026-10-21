export interface Product { id: string; name: string; price: string; imageUrl: string; available: boolean }
export interface ProductList { items: Product[]; currency: 'VND' }
export interface ProductDetail extends Product {
  sizes: { size: string; extraPrice: string }[];
  toppings: { id: string; name: string; price: string }[];
}

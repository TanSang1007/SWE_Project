export interface AdminProduct {
  id: string; name: string; price: string; imageUrl: string; stock: number; isActive: boolean; version: number;
  createdAt: string; updatedAt: string;
  sizes: { size: 'S' | 'M' | 'L'; extraPrice: string }[];
  toppings: { id: string; name: string; price: string; createdAt: string; updatedAt: string }[];
}
export interface ProductCreate {
  name: string; price: string; imageUrl: string; sizes: AdminProduct['sizes']; toppingIds: string[];
}
export interface ProductUpdate {
  expectedVersion: number; name?: string; price?: string; imageUrl?: string; isActive?: boolean;
}

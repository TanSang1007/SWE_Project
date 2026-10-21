export interface CartItem {
  id: string; productId: string; productName: string; imageUrl: string; available: boolean;
  size: string; qty: number; toppings: { id: string; name: string; price: string }[];
  unitPrice: string; lineTotal: string;
}
export interface Cart { items: CartItem[]; totalQuantity: number; subtotal: string; currency: 'VND'; }
export interface CartInput { productId: string; size: string; toppingIds: string[]; qty: number; }

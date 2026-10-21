import type { CartInput } from './cart';
export interface OrderInput { items: CartInput[]; promotionCode?: string; redeemedPoints?: number; }
export interface Order {
  id: string; orderCode: string; status: 'PENDING' | 'PAYMENT_FAILED' | 'CANCELLED' | 'PAID' | 'PREPARING' | 'READY' | 'COMPLETED';
  currency: 'VND'; items: { productId: string; productName: string; size: string; qty: number; unitPrice: string; lineTotal: string; toppings: { name: string; price: string }[] }[];
  redeemedPoints?: number; loyaltyDiscountAmount?: string; redemptionState?: 'NONE'|'RESERVED'|'RELEASED'|'SETTLED'|'REFUNDED'; estimatedEarnedPoints?: number;
  subtotal: string; discountAmount: string; total: string; promotionCode: string | null; createdAt: string;
}
export interface OrderDetail extends Order {
  paidAt: string | null; earnedPoints: number | null; paymentStatus: 'SUCCEEDED' | 'FAILED' | null;
}
export type OrderHistoryItem = Pick<Order, 'id' | 'orderCode' | 'status' | 'total' | 'currency' | 'createdAt' | 'redeemedPoints' | 'loyaltyDiscountAmount' | 'redemptionState'> & { earnedPoints: number | null };

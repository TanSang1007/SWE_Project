import type { CartInput } from './cart';
export interface OrderInput { items: CartInput[]; promotionCode?: string; redeemedPoints?: number; }
export interface Order {
  paymentStartedAt?: string | null; expiresAt?: string | null; serverNow?: string; paymentExpiredAt?: string | null; cancellationReason?: string | null;
  // orderCode: global DB code; customerOrderCode: per-account sequence shown to customers.
  id: string; orderCode: string; customerOrderCode: string; status: 'PENDING' | 'PAYMENT_FAILED' | 'CANCELLED' | 'PAID' | 'PREPARING' | 'READY' | 'COMPLETED';
  currency: 'VND'; items: { productId: string; productName: string; size: string; qty: number; unitPrice: string; lineTotal: string; toppings: { name: string; price: string }[] }[];
  redeemedPoints?: number; loyaltyDiscountAmount?: string; redemptionState?: 'NONE'|'RESERVED'|'RELEASED'|'SETTLED'|'REFUNDED'; estimatedEarnedPoints?: number;
  subtotal: string; discountAmount: string; total: string; promotionCode: string | null; createdAt: string;
}
export interface OrderDetail extends Order {
  paidAt: string | null; earnedPoints: number | null; paymentStatus: 'SUCCEEDED' | 'FAILED' | null;
}
export type OrderHistoryItem = Pick<Order, 'id' | 'orderCode' | 'customerOrderCode' | 'status' | 'total' | 'currency' | 'createdAt' | 'redeemedPoints' | 'loyaltyDiscountAmount' | 'redemptionState'> & { earnedPoints: number | null };

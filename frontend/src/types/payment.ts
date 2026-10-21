export interface PaymentInput { orderId: string; method: 'WALLET' | 'CARD'; }
export interface PaymentResult {
  payment: { id: string; orderId: string; status: 'SUCCEEDED' | 'FAILED'; amount: string; method: 'WALLET' | 'CARD'; failureCode?: 'MOCK_DECLINED' };
  order: { id: string; orderCode: string; status: 'PAID' | 'PAYMENT_FAILED' };
  loyalty: { awardedPoints: number; redeemedPoints?: number; redemptionState?: 'NONE'|'SETTLED'|'RELEASED'; debtOffsetPoints?: number; availablePointsAdded?: number };
}

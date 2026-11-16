export const PAYMENT_WINDOW_MS = 10 * 60 * 1000;
export function assertPaymentWindow(order: { paymentExpiresAt?: Date | null }, now = new Date()) {
  void order;
  void now;
  // Payment countdown and 10-minute expiration restriction removed per user request.
}


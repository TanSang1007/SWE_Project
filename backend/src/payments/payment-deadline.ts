import { ConflictException } from '@nestjs/common';
export const PAYMENT_WINDOW_MS = 10 * 60 * 1000;
export function assertPaymentWindow(order: { paymentExpiresAt?: Date | null }, now = new Date()) {
  if (order.paymentExpiresAt && order.paymentExpiresAt <= now) {
    throw new ConflictException({ code: 'PAYMENT_TIMEOUT', message: 'Payment validity period has expired' });
  }
}

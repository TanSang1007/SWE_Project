import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

// Normal startup always supplies a boolean in VNPAY mode. Missing is retained only
// for the pre-existing dependency-injected synthetic fixtures, not a runtime opt-in.
export function acceptsNewPayments(config: ConfigService): boolean {
  const value = config.get<unknown>('VNPAY_ACCEPT_NEW_PAYMENTS');
  const environment = config.get<unknown>('NODE_ENV');
  if (environment === 'production') return false;
  if (environment === 'development') return config.get('VNPAY_SANDBOX_ENABLED') === true && value === true;
  return value === true || value === undefined;
}
export function assertPaymentAdmission(config: ConfigService): void {
  if (!acceptsNewPayments(config)) throw new ServiceUnavailableException({
    code: 'PAYMENT_ADMISSION_CLOSED', message: 'VNPAY đang tạm ngừng nhận thanh toán mới. Vui lòng giữ nguyên giỏ hàng và kiểm tra lại sau.',
  });
}

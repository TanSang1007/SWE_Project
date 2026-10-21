import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client';
import { validateVnpayConfig, type VnpayConfig } from './vnpay/vnpay-config';

// Startup validates provider eligibility; this resolver never opts a provider in.
export function effectivePaymentProvider(config: ConfigService): 'MOCK' | 'VNPAY_SANDBOX' {
  const mode = config.get<unknown>('PAYMENT_PROVIDER_MODE') ?? 'MOCK';
  if (mode === 'MOCK') return mode;
  try {
    if (mode !== 'VNPAY_SANDBOX') throw Error();
    validateVnpayConfig(config.getOrThrow<VnpayConfig>('VNPAY_INITIATION_CONFIG'));
    return mode;
  } catch {
    throw new ServiceUnavailableException({ code: 'PAYMENT_UNAVAILABLE', message: 'Payment unavailable' });
  }
}

// Issuance policy only. Never use this to reject authentic historical callbacks.
export function belowVnpayMinimum(total: Prisma.Decimal): boolean {
  return total.gt(0) && total.lt(5000);
}

export function assertVnpayMinimum(total: Prisma.Decimal): void {
  if (belowVnpayMinimum(total)) throw new UnprocessableEntityException({
    code: 'VNPAY_MINIMUM_AMOUNT_NOT_MET',
    message: 'Thanh toán VNPAY yêu cầu số tiền tối thiểu 5.000đ. Vui lòng điều chỉnh giỏ hàng hoặc số điểm sử dụng.',
  });
}

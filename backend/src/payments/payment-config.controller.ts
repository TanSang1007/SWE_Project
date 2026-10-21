import { Body, Controller, Get, Header, Query, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PaymentEmptyDto } from './payment.dto';
import { initiationSettings } from './vnpay/initiation-config';
import type { VnpayConfig } from './vnpay/vnpay-config';
import { acceptsNewPayments } from './payment-admission';

@Controller('payments/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class PaymentConfigController {
  constructor(private readonly config: ConfigService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store, max-age=0')
  get(@Query() query: PaymentEmptyDto, @Body() body: PaymentEmptyDto, @Res({ passthrough: true }) res: Response) {
    void query; void body; res.vary('Authorization');
    const mode = this.config.get<unknown>('PAYMENT_PROVIDER_MODE');
    if (mode === 'MOCK') return { providerMode: 'MOCK' as const };
    try {
      if (mode !== 'VNPAY_SANDBOX') throw Error('Unavailable');
      const c = this.config.get<VnpayConfig>('VNPAY_INITIATION_CONFIG');
      if (!c) throw Error('Unavailable');
      // Reuse the existing startup gate; never infer readiness from mode alone.
      initiationSettings({ NODE_ENV: this.config.get('NODE_ENV'), PAYMENT_PROVIDER_MODE: mode,
        DATABASE_URL: this.config.get('DATABASE_URL'), TEST_DATABASE_URL: this.config.get('TEST_DATABASE_URL'),
        VNPAY_INITIATION_TEST_ONLY: this.config.get('VNPAY_INITIATION_TEST_ONLY'),
        VNPAY_SANDBOX_ENABLED: this.config.get('VNPAY_SANDBOX_ENABLED'),
        VNPAY_ACCEPT_NEW_PAYMENTS: this.config.get('VNPAY_ACCEPT_NEW_PAYMENTS'),
        FRONTEND_ORIGIN: this.config.get('FRONTEND_ORIGIN'), VNPAY_RESULT_URL: this.config.get('VNPAY_RESULT_URL'),
        VNPAY_ENV: c.environment, VNPAY_VERSION: c.version, VNPAY_TMN_CODE: c.merchantCode,
        VNPAY_HASH_SECRET: c.hashSecret, VNPAY_PAYMENT_URL: c.paymentUrl, VNPAY_RETURN_URL: c.returnUrl, VNPAY_IPN_URL: c.ipnUrl });
      return acceptsNewPayments(this.config) ? { providerMode: 'VNPAY_SANDBOX' as const }
        : { providerMode: 'VNPAY_SANDBOX' as const, acceptingNewPayments: false as const };
    } catch {
      throw new ServiceUnavailableException({ code: 'PAYMENT_UNAVAILABLE', message: 'Payment unavailable' });
    }
  }
}

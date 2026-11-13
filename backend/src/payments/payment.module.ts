import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { AttemptController } from './attempt.controller';
import { AttemptService } from './attempt.service';
import { IpnController } from './ipn.controller';
import { IpnService } from './ipn.service';
import { QueryDrController } from './querydr.controller';
import { QueryDrService } from './querydr.service';
import { QUERYDR_TRANSPORT, disabledQueryDrTransport } from './vnpay/querydr-transport';
import { ZeroConfirmationController } from './zero-confirmation.controller';
import { ZeroConfirmationService } from './zero-confirmation.service';
import { BrowserReturnController } from './browser-return.controller';
import { BrowserReturnService } from './browser-return.service';
import { PaymentConfigController } from './payment-config.controller';
import { SandboxProfileService } from './sandbox-profile.service';
import { PaymentReceiptWorker } from './payment-receipt.worker';
import { MockPaymentController, MockPaymentService } from './mock-payment.controller';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    AttemptController,
    IpnController,
    QueryDrController,
    ZeroConfirmationController,
    BrowserReturnController,
    PaymentConfigController,
    MockPaymentController,
  ],
  providers: [
    AttemptService,
    IpnService,
    QueryDrService,
    ZeroConfirmationService,
    BrowserReturnService,
    SandboxProfileService,
    PaymentReceiptWorker,
    MockPaymentService,
    { provide: QUERYDR_TRANSPORT, useValue: disabledQueryDrTransport },
  ],
})
export class PaymentModule {}

import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { MockPaymentService } from './mock-payment.service';
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
@Module({ imports: [DatabaseModule, AuthModule], controllers: [PaymentController, AttemptController, IpnController, QueryDrController, ZeroConfirmationController, BrowserReturnController, PaymentConfigController], providers: [PaymentService, MockPaymentService, AttemptService, IpnService, QueryDrService, ZeroConfirmationService, BrowserReturnService,
  SandboxProfileService, { provide: QUERYDR_TRANSPORT, useValue: disabledQueryDrTransport }] })
export class PaymentModule {}

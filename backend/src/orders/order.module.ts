import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PricingModule } from '../pricing/pricing.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OperatorOrderController } from './operator-order.controller';
import { AdminOrderController } from './admin-order.controller';
import { PaymentExpirationWorker } from './payment-expiration.worker';
@Module({ imports: [DatabaseModule, PricingModule], controllers: [OrderController, OperatorOrderController, AdminOrderController], providers: [OrderService, PaymentExpirationWorker] })
export class OrderModule {}

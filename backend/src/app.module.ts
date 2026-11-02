import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health.controller';
import { CatalogModule } from './catalog/catalog.module';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { PricingModule } from './pricing/pricing.module';
import { OrderModule } from './orders/order.module';
import { PaymentModule } from './payments/payment.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { IngredientModule } from './ingredients/ingredient.module';

@Module({ imports: [AppConfigModule, DatabaseModule, CatalogModule, AuthModule, CartModule, PricingModule, OrderModule, PaymentModule, LoyaltyModule, IngredientModule], controllers: [HealthController] })
export class AppModule {}

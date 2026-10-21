import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
@Module({ imports: [AuthModule, DatabaseModule], controllers: [LoyaltyController], providers: [LoyaltyService] })
export class LoyaltyModule {}

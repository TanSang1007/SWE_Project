import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
@Module({ imports: [AuthModule, DatabaseModule], controllers: [CartController], providers: [CartService] })
export class CartModule {}

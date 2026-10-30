import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { IngredientController } from './ingredient.controller';
import { IngredientService } from './ingredient.service';
@Module({ imports: [AuthModule,DatabaseModule], controllers: [IngredientController], providers: [IngredientService] })
export class IngredientModule {}

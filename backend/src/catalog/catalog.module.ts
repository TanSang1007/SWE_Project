import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { AdminProductController } from './admin-product.controller';
import { AdminProductService } from './admin-product.service';
import { AuthModule } from '../auth/auth.module';
import { AdminOptionService } from './admin-option.service';
import { AdminProductOptionController, AdminToppingController } from './admin-option.controller';
import { AdminInventoryService } from './admin-inventory.service';
import { AdminInventoryController } from './admin-inventory.controller';

@Module({ imports: [DatabaseModule, AuthModule], controllers: [CatalogController, AdminProductController, AdminProductOptionController, AdminToppingController, AdminInventoryController], providers: [CatalogService, AdminProductService, AdminOptionService, AdminInventoryService] })
export class CatalogModule {}

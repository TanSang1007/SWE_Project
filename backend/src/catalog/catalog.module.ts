import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { AdminProductController } from './admin-product.controller';
import { AdminProductService } from './admin-product.service';
import { AuthModule } from '../auth/auth.module';
import { AdminOptionService } from './admin-option.service';
import { AdminProductOptionController, AdminToppingController } from './admin-option.controller';
// Manual Product.stock adjustments are retired. Keep historical columns/audit;
// new sales use recipes and ingredient reservations, configured in ingredients/.
@Module({ imports: [DatabaseModule, AuthModule], controllers: [CatalogController, AdminProductController, AdminProductOptionController, AdminToppingController], providers: [CatalogService, AdminProductService, AdminOptionService] })
export class CatalogModule {}

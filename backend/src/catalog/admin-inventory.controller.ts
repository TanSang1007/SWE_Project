import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CatalogQueryDto, ProductParamsDto } from './dto/catalog.dto';
import { InventoryAdjustmentDto } from './admin-inventory.dto';
import { AdminInventoryService } from './admin-inventory.service';
@Controller('admin') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN')
export class AdminInventoryController {
  constructor(private readonly inventory: AdminInventoryService) {}
  @Get('inventory') @Header('Cache-Control', 'private, no-store, max-age=0')
  list(@Query() query: CatalogQueryDto, @Body() body: CatalogQueryDto, @Res({ passthrough: true }) res: Response) {
    void query; void body; res.vary('Authorization'); return this.inventory.list();
  }
  @Post('products/:id/inventory-adjustments') @HttpCode(200) @Header('Cache-Control', 'private, no-store, max-age=0')
  async adjust(@Req() req: Request & { user: { id: string } }, @Param() params: ProductParamsDto,
    @Headers('idempotency-key') key: string | undefined, @Body() body: InventoryAdjustmentDto,
    @Query() query: CatalogQueryDto, @Res({ passthrough: true }) res: Response) {
    void query; res.vary('Authorization'); const result = await this.inventory.adjust(req.user.id, params.id.toLowerCase(), key, body);
    res.status(result.status); if (result.replayed) res.setHeader('Idempotency-Replayed', 'true'); return result.body;
  }
}

import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CatalogQueryDto, ProductParamsDto } from './dto/catalog.dto';
import { ProductCreateDto, ProductUpdateDto, ProductVersionDto } from './admin-product.dto';
import { AdminProductService } from './admin-product.service';
@Controller('admin/products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminProductController {
  constructor(private readonly products: AdminProductService) {}
  @Get() @Header('Cache-Control', 'private, no-store, max-age=0')
  list(@Query() query: CatalogQueryDto, @Body() body: CatalogQueryDto, @Res({ passthrough: true }) res: Response) {
    void query; void body; res.vary('Authorization'); return this.products.list();
  }
  @Get(':id') @Header('Cache-Control', 'private, no-store, max-age=0')
  get(@Param() params: ProductParamsDto, @Query() query: CatalogQueryDto, @Body() body: CatalogQueryDto, @Res({ passthrough: true }) res: Response) {
    void query; void body; res.vary('Authorization'); return this.products.get(params.id.toLowerCase());
  }
  @Post() @Header('Cache-Control', 'private, no-store, max-age=0')
  create(@Body() body: ProductCreateDto, @Query() query: CatalogQueryDto, @Res({ passthrough: true }) res: Response) {
    void query; res.vary('Authorization'); return this.products.create(body);
  }
  @Patch(':id') @Header('Cache-Control', 'private, no-store, max-age=0')
  update(@Param() params: ProductParamsDto, @Body() body: ProductUpdateDto, @Query() query: CatalogQueryDto, @Res({ passthrough: true }) res: Response) {
    void query; res.vary('Authorization'); return this.products.update(params.id.toLowerCase(), body);
  }
  @Delete(':id') @HttpCode(204) @Header('Cache-Control', 'private, no-store, max-age=0')
  remove(@Param() params: ProductParamsDto, @Body() body: ProductVersionDto, @Query() query: CatalogQueryDto, @Res({ passthrough: true }) res: Response) {
    void query; res.vary('Authorization'); return this.products.remove(params.id.toLowerCase(), body.expectedVersion);
  }
}

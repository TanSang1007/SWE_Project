import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CatalogQueryDto, ProductParamsDto } from './dto/catalog.dto';
import { ProductVersionDto } from './admin-product.dto';
import { AdminSizeCreateDto, AdminSizeUpdateDto, AssociationCreateDto, AssociationParamsDto, SizeParamsDto, ToppingCreateDto, ToppingUpdateDto } from './admin-option.dto';
import { AdminOptionService } from './admin-option.service';
const vary = (res: Response) => res.vary('Authorization');
@Controller('admin/products/:id') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN')
export class AdminProductOptionController {
  constructor(private readonly options: AdminOptionService) {}
  @Get('sizes') @Header('Cache-Control', 'private, no-store, max-age=0')
  sizes(@Param() p: ProductParamsDto, @Query() q: CatalogQueryDto, @Body() b: CatalogQueryDto, @Res({ passthrough: true }) r: Response) { void q; void b; vary(r); return this.options.sizes(p.id.toLowerCase()); }
  @Post('sizes') @Header('Cache-Control', 'private, no-store, max-age=0')
  add(@Param() p: ProductParamsDto, @Query() q: CatalogQueryDto, @Body() b: AdminSizeCreateDto, @Res({ passthrough: true }) r: Response) { void q; vary(r); return this.options.createSize(p.id.toLowerCase(), b); }
  @Patch('sizes/:size') @Header('Cache-Control', 'private, no-store, max-age=0')
  update(@Param() p: SizeParamsDto, @Query() q: CatalogQueryDto, @Body() b: AdminSizeUpdateDto, @Res({ passthrough: true }) r: Response) { void q; vary(r); return this.options.updateSize(p.id.toLowerCase(), p.size, b); }
  @Delete('sizes/:size') @HttpCode(204) @Header('Cache-Control', 'private, no-store, max-age=0')
  remove(@Param() p: SizeParamsDto, @Query() q: CatalogQueryDto, @Body() b: ProductVersionDto, @Res({ passthrough: true }) r: Response) { void q; vary(r); return this.options.deleteSize(p.id.toLowerCase(), p.size, b.expectedVersion); }
  @Get('toppings') @Header('Cache-Control', 'private, no-store, max-age=0')
  toppings(@Param() p: ProductParamsDto, @Query() q: CatalogQueryDto, @Body() b: CatalogQueryDto, @Res({ passthrough: true }) r: Response) { void q; void b; vary(r); return this.options.productToppings(p.id.toLowerCase()); }
  @Post('toppings') @Header('Cache-Control', 'private, no-store, max-age=0')
  attach(@Param() p: ProductParamsDto, @Query() q: CatalogQueryDto, @Body() b: AssociationCreateDto, @Res({ passthrough: true }) r: Response) { void q; vary(r); return this.options.attach(p.id.toLowerCase(), b.toppingId.toLowerCase(), b.expectedVersion); }
  @Delete('toppings/:toppingId') @HttpCode(204) @Header('Cache-Control', 'private, no-store, max-age=0')
  detach(@Param() p: AssociationParamsDto, @Query() q: CatalogQueryDto, @Body() b: ProductVersionDto, @Res({ passthrough: true }) r: Response) { void q; vary(r); return this.options.detach(p.id.toLowerCase(), p.toppingId.toLowerCase(), b.expectedVersion); }
}
@Controller('admin/toppings') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN')
export class AdminToppingController {
  constructor(private readonly options: AdminOptionService) {}
  @Get() @Header('Cache-Control', 'private, no-store, max-age=0')
  list(@Query() q: CatalogQueryDto, @Body() b: CatalogQueryDto, @Res({ passthrough: true }) r: Response) { void q; void b; vary(r); return this.options.toppings(); }
  @Get(':id') @Header('Cache-Control', 'private, no-store, max-age=0')
  get(@Param() p: ProductParamsDto, @Query() q: CatalogQueryDto, @Body() b: CatalogQueryDto, @Res({ passthrough: true }) r: Response) { void q; void b; vary(r); return this.options.topping(p.id.toLowerCase()); }
  @Post() @Header('Cache-Control', 'private, no-store, max-age=0')
  create(@Query() q: CatalogQueryDto, @Body() b: ToppingCreateDto, @Res({ passthrough: true }) r: Response) { void q; vary(r); return this.options.createTopping(b); }
  @Patch(':id') @Header('Cache-Control', 'private, no-store, max-age=0')
  update(@Param() p: ProductParamsDto, @Query() q: CatalogQueryDto, @Body() b: ToppingUpdateDto, @Res({ passthrough: true }) r: Response) { void q; vary(r); return this.options.updateTopping(p.id.toLowerCase(), b); }
  @Delete(':id') @HttpCode(204) @Header('Cache-Control', 'private, no-store, max-age=0')
  remove(@Param() p: ProductParamsDto, @Query() q: CatalogQueryDto, @Body() b: ProductVersionDto, @Res({ passthrough: true }) r: Response) { void q; vary(r); return this.options.deleteTopping(p.id.toLowerCase(), b.expectedVersion); }
}

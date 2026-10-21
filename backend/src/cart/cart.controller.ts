import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AddCartItemDto, CartDeleteDto, CartParamsDto, CartQuantityDto, CartQueryDto } from './cart.dto';
import { CartService } from './cart.service';
type AuthRequest = Request & { user: { id: string } };
@Controller('cart')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class CartController {
  constructor(private readonly cart: CartService) {}
  @Get()
  get(@Req() req: AuthRequest, @Query() query: CartQueryDto) { void query; return this.cart.get(req.user.id); }
  @Post('items')
  add(@Req() req: AuthRequest, @Body() body: AddCartItemDto, @Query() query: CartQueryDto) { void query; return this.cart.add(req.user.id, body); }
  @Patch('items/:id')
  update(@Req() req: AuthRequest, @Param() params: CartParamsDto, @Body() body: CartQuantityDto, @Query() query: CartQueryDto) {
    void query; return this.cart.update(req.user.id, params.id, body.qty);
  }
  @Delete('items/:id')
  remove(@Req() req: AuthRequest, @Param() params: CartParamsDto, @Body() body: CartDeleteDto, @Query() query: CartQueryDto) {
    void query; void body; return this.cart.remove(req.user.id, params.id);
  }
}

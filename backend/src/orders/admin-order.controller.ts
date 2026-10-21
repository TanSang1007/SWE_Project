import { Body, Controller, Header, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrderEmptyDto, OrderParamsDto } from './order.dto';
import { PaidCancelDto } from './order-workflow.dto';
import { OrderService } from './order.service';

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminOrderController {
  constructor(private readonly orders: OrderService) {}
  @Post(':id/paid-cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  cancelPaid(@Param() params: OrderParamsDto, @Body() body: PaidCancelDto, @Query() query: OrderEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void query; res.vary('Authorization');
    return this.orders.transitionOrder(params.id.toLowerCase(), body.expectedVersion, 'CANCELLED');
  }
}

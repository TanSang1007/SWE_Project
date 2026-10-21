import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsEnum, ValidateIf } from 'class-validator';
import { OrderStatus, type UserRole } from '../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrderEmptyDto, OrderParamsDto } from './order.dto';
import { OrderService } from './order.service';
import { OrderTransitionDto } from './order-workflow.dto';

export class OperatorOrderQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

@Controller('operator/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STAFF', 'ADMIN')
export class OperatorOrderController {
  constructor(private readonly orders: OrderService) {}

  @Post(':id/transitions')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  transition(@Param() params: OrderParamsDto, @Body() body: OrderTransitionDto, @Query() query: OrderEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void query; res.vary('Authorization');
    return this.orders.transitionOrder(params.id.toLowerCase(), body.expectedVersion, body.targetStatus);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store, max-age=0')
  list(@Query() query: OperatorOrderQueryDto, @Body() body: OrderEmptyDto,
    @Res({ passthrough: true }) res: Response, @Req() req: { user: { role: UserRole } }) {
    void body;
    res.vary('Authorization');
    return this.orders.operatorHistory(req.user.role, query.status);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  get(@Param() params: OrderParamsDto, @Query() query: OrderEmptyDto, @Body() body: OrderEmptyDto,
    @Res({ passthrough: true }) res: Response, @Req() req: { user: { role: UserRole } }) {
    void query; void body;
    res.vary('Authorization');
    return this.orders.operatorGet(req.user.role, params.id.toLowerCase());
  }
}

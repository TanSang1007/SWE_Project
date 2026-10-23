import { Body, Controller, Get, Header, Headers, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateOrderDto, OrderEmptyDto, OrderParamsDto } from './order.dto';
import { OrderService } from './order.service';
type AuthRequest = Request & { user: { id: string } };
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class OrderController {
  constructor(private readonly orders: OrderService) {}
  @Post()
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async create(@Req() req: AuthRequest, @Headers('idempotency-key') key: string | undefined, @Body() body: CreateOrderDto,
    @Query() query: OrderEmptyDto, @Res({ passthrough: true }) res: Response) {
    void query;
    res.vary('Authorization');
    const result = await this.orders.create(req.user.id, key, body);
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }
  @Post('preview')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  preview(@Req() req: AuthRequest, @Body() body: CreateOrderDto, @Query() query: OrderEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void query; res.status(200); res.vary('Authorization'); return this.orders.preview(req.user.id, body);
  }
  @Get('me')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  history(@Req() req: AuthRequest, @Query() query: OrderEmptyDto, @Body() body: OrderEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void query; void body; res.vary('Authorization'); return this.orders.history(req.user.id);
  }
  @Get('active')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  active(@Req() req: AuthRequest, @Query() query: OrderEmptyDto, @Body() body: OrderEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void query; void body; res.vary('Authorization'); return this.orders.active(req.user.id);
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  get(@Req() req: AuthRequest, @Param() params: OrderParamsDto, @Query() query: OrderEmptyDto, @Body() body: OrderEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void query; void body; res.vary('Authorization'); return this.orders.get(req.user.id, params.id);
  }
  @Post(':id/cancel')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async cancel(@Req() req: AuthRequest, @Param() params: OrderParamsDto, @Body() body: OrderEmptyDto, @Query() query: OrderEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void body; void query; res.status(200); res.vary('Authorization');
    return this.orders.cancel(req.user.id, params.id);
  }
}

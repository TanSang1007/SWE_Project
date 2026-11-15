import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { UserRole } from '../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrderService } from './order.service';
import { OrderEmptyDto, OrderParamsDto, OrderReadParamsDto } from './order.dto';
import { RefundUpdateDto, SupportParamsDto, SupportRequestDto, SupportReviewDto } from './order-aftercare.dto';
type Actor = { user: { id: string; role: UserRole } };
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER','STAFF','ADMIN')
export class OrderAftercareController {
  constructor(private readonly orders: OrderService) {}
  @Get(':id/tracking') @Header('Cache-Control','private, no-store, max-age=0')
  tracking(@Param() p: OrderReadParamsDto, @Req() r: Actor, @Query() q: OrderEmptyDto, @Body() b: OrderEmptyDto, @Res({passthrough:true}) res: Response) {
    void q; void b; res.vary('Authorization'); return this.orders.tracking(r.user.id,r.user.role,p.id);
  }
  @Post(':id/support-requests') @HttpCode(200) @Header('Cache-Control','private, no-store, max-age=0')
  support(@Param() p: OrderParamsDto, @Req() r: Actor, @Headers('idempotency-key') key: string|undefined, @Body() b: SupportRequestDto, @Query() q: OrderEmptyDto, @Res({passthrough:true}) res: Response) {
    void q; res.vary('Authorization'); return this.orders.supportRequest(r.user.id,r.user.role,p.id,key,b.reason);
  }
}
@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminAftercareController {
  constructor(private readonly orders: OrderService) {}
  @Post(':id/support-requests/:requestId/review') @HttpCode(200) @Header('Cache-Control','private, no-store, max-age=0')
  review(@Param() p: SupportParamsDto, @Req() r: Actor, @Body() b: SupportReviewDto, @Query() q: OrderEmptyDto, @Res({passthrough:true}) res: Response) {
    void q; res.vary('Authorization'); return this.orders.reviewSupport(r.user.id,p.id,p.requestId,b);
  }
  @Post(':id/refund') @HttpCode(200) @Header('Cache-Control','private, no-store, max-age=0')
  refund(@Param() p: OrderParamsDto, @Req() r: Actor, @Body() b: RefundUpdateDto, @Query() q: OrderEmptyDto, @Res({passthrough:true}) res: Response) {
    void q; res.vary('Authorization'); return this.orders.updateRefund(r.user.id,p.id,b);
  }
}

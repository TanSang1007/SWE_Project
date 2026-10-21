import { Body, Controller, Headers, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PaymentDto, PaymentEmptyDto } from './payment.dto';
import { PaymentService } from './payment.service';
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}
  @Post() @HttpCode(200)
  async pay(@Req() req: Request & { user: { id: string } }, @Body() body: PaymentDto,
    @Headers('idempotency-key') key: string | undefined, @Query() query: PaymentEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void query;
    const result = await this.payments.pay(req.user.id, key, body);
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }
}

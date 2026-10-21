import { BadRequestException, Body, Controller, Header, Headers, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrderEmptyDto, OrderParamsDto } from '../orders/order.dto';
import { ZeroConfirmationService } from './zero-confirmation.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class ZeroConfirmationController {
  constructor(private readonly confirmations: ZeroConfirmationService) {}
  @Post(':id/confirm-zero')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async confirm(@Req() req: Request & { user: { id: string } }, @Param() p: OrderParamsDto,
    @Headers('idempotency-key') key: string | undefined, @Body() body: OrderEmptyDto, @Query() query: OrderEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void body; void query;
    const raw: unknown = req.body;
    if ((req.headers['content-length'] && req.headers['content-length'] !== '0') || req.headers['transfer-encoding']) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Expected an empty JSON object' });
    }
    res.vary('Authorization');
    const result = await this.confirmations.confirm(req.user.id, key, p.id.toLowerCase());
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }
}

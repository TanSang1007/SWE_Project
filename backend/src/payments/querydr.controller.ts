import { Body, Controller, ForbiddenException, Header, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AttemptEmptyDto } from './attempt.dto';
import { QueryDrService } from './querydr.service';
class ReconcileParams { @IsUUID() id!: string; }
@Controller('admin/payments/vnpay/attempts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class QueryDrController {
  constructor(private readonly queries: QueryDrService) {}
  @Post(':id/reconcile')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  async reconcile(@Param() p: ReconcileParams, @Body() body: AttemptEmptyDto, @Query() query: AttemptEmptyDto,
    @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    void body; void query;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
      || req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'])
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Local access required' });
    res.vary('Authorization');
    const result = await this.queries.reconcile(p.id.toLowerCase());
    res.status(result.status);
    return result.body;
  }
}

import { Body, Controller, Get, Header, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyHistoryQueryDto } from './loyalty.dto';
export class LoyaltyEmptyDto {}
type AuthRequest = Request & { user: { id: string } };

@Controller('loyalty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}
  @Get('transactions')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  transactions(@Req() req: AuthRequest, @Query() query: LoyaltyHistoryQueryDto, @Body() body: LoyaltyEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void body; res.vary('Authorization'); return this.loyalty.history(req.user.id, query);
  }
  @Get()
  @Header('Cache-Control', 'private, no-store, max-age=0')
  get(@Req() req: AuthRequest, @Query() query: LoyaltyEmptyDto, @Body() body: LoyaltyEmptyDto,
    @Res({ passthrough: true }) res: Response) {
    void query; void body;
    res.vary('Authorization');
    return this.loyalty.balance(req.user.id);
  }
}

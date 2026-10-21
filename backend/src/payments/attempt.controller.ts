import { Body, Controller, Get, Header, Headers, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AttemptEmptyDto, AttemptListDto, AttemptOrderParamsDto, AttemptParamsDto, InitiateAttemptDto } from './attempt.dto';
import { AttemptService } from './attempt.service';
type AuthRequest = Request & {
    user: {
        id: string;
    };
};
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class AttemptController {
    constructor(private readonly attempts: AttemptService) { }
    @Post('payments/vnpay/attempts')
    @Header('Cache-Control', 'private, no-store, max-age=0')
    async initiate(
    @Req()
    req: AuthRequest,
    @Body()
    body: InitiateAttemptDto,
    @Query()
    query: AttemptEmptyDto,
    @Headers('idempotency-key')
    key: string | undefined,
    @Res({ passthrough: true })
    res: Response) {
        void query;
        res.vary('Authorization');
        const result = await this.attempts.initiate(req.user.id, key, body.orderId, req.socket.remoteAddress ?? '');
        if (result.replayed)
            res.setHeader('Idempotency-Replayed', 'true');
        return result.body;
    }
    @Get('payments/attempts/:attemptId')
    @Header('Cache-Control', 'private, no-store, max-age=0')
    get(
    @Req()
    req: AuthRequest,
    @Param()
    p: AttemptParamsDto,
    @Query()
    query: AttemptEmptyDto,
    @Body()
    body: AttemptEmptyDto,
    @Res({ passthrough: true })
    res: Response) {
        void query;
        void body;
        res.vary('Authorization');
        return this.attempts.get(req.user.id, p.attemptId.toLowerCase());
    }
    @Get('orders/:id/payment-attempts')
    @Header('Cache-Control', 'private, no-store, max-age=0')
    list(
    @Req()
    req: AuthRequest,
    @Param()
    p: AttemptOrderParamsDto,
    @Query()
    query: AttemptListDto,
    @Body()
    body: AttemptEmptyDto,
    @Res({ passthrough: true })
    res: Response) {
        void body;
        res.vary('Authorization');
        return this.attempts.list(req.user.id, p.id.toLowerCase(), query);
    }
}

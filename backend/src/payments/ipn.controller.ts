import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IpnService } from './ipn.service';
@Controller('payments/vnpay')
export class IpnController {
    constructor(private readonly ipn: IpnService) { }
    @Get('ipn')
    async receive(
    @Req()
    req: Request,
    @Res()
    res: Response) {
        const marker = req.originalUrl.indexOf('?');
        const ack = await this.ipn.receive(marker < 0 ? '' : req.originalUrl.slice(marker + 1));
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(ack);
    }
}

import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BrowserReturnService } from './browser-return.service';
import { sendBrowserReturn } from './vnpay/return-redirect';

@Controller('payments/vnpay')
export class BrowserReturnController {
  constructor(private readonly returns: BrowserReturnService) {}
  @Get('return')
  async receive(@Req() req: Request, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const marker = req.originalUrl.indexOf('?');
    const destination = await this.returns.resolve(marker < 0 ? '' : req.originalUrl.slice(marker + 1));
    sendBrowserReturn(res, destination);
  }
}

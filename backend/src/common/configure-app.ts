import { BadRequestException, PayloadTooLargeException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { getBodyParserStatus, HttpExceptionFilter } from './http-exception.filter';
import { browserReturnBase, sendBrowserReturn } from '../payments/vnpay/return-redirect';

export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  // Provider callbacks have their own ACK contract and never accept body overrides.
  // Reject framed bodies before JSON parsing, including malformed/oversized JSON.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD'].includes(req.method) && req.path.toLowerCase().replace(/\/+$/, '') === '/payments/vnpay/return'
      && ((req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0') || req.headers['transfer-encoding'])) {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
      try { sendBrowserReturn(res, browserReturnBase(config.get<unknown>('FRONTEND_ORIGIN'))); }
      catch (error) { next(error); }
      return;
    }
    if (req.method === 'GET' && req.path.toLowerCase().replace(/\/+$/, '') === '/payments/vnpay/ipn'
      && ((req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0') || req.headers['transfer-encoding'])) {
      res.setHeader('Cache-Control', 'no-store'); res.status(200).json({ RspCode:'99', Message:'Unable to confirm' }); return;
    }
    next();
  });
  app.useBodyParser('json', { limit: '64kb' });
  // Normalize raw parser errors before Nest wraps SyntaxError messages.
  app.use((error: unknown, _request: Request, _response: Response, next: NextFunction): void => {
    const status = getBodyParserStatus(error);
    if (status === 400) next(new BadRequestException('Invalid JSON request body'));
    else if (status === 413) next(new PayloadTooLargeException('Request payload too large'));
    else next(error);
  });
  app.enableCors({
    origin: config.getOrThrow<string>('FRONTEND_ORIGIN'),
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-BrewLite-CSRF'],
    exposedHeaders: ['Idempotency-Replayed'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
}

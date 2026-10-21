import { ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';

// P00 local-browser topology. Changing the destination requires a separate task.
export function browserReturnBase(frontendOrigin: unknown): string {
  if (frontendOrigin !== 'http://localhost:3000')
    throw new ServiceUnavailableException({ code: 'PAYMENT_UNAVAILABLE', message: 'Payment return unavailable' });
  return 'http://localhost:3000/payments/vnpay/result';
}

export function sendBrowserReturn(res: Response, destination: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Empty response body: no raw provider query or reflected message in HTML.
  res.setHeader('Location', destination);
  res.status(303).end();
}

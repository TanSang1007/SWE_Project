import { ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';

// P00 local-browser topology + Render deploy sandbox HTTPS origin.
export function browserReturnBase(frontendOrigin: unknown, deploySandbox = false): string {
  if (deploySandbox && typeof frontendOrigin === 'string') {
    try {
      const url = new URL(frontendOrigin);
      if (url.protocol === 'https:' && url.origin === frontendOrigin && url.hostname.endsWith('.onrender.com')) {
        return `${frontendOrigin}/payments/vnpay/result`;
      }
    } catch { /* fall through */ }
  }
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

import type { Request, Response } from 'express';
import { QueryDrController } from '../src/payments/querydr.controller';
import { QueryDrService } from '../src/payments/querydr.service';
import { PrismaService } from '../src/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IpnService } from '../src/payments/ipn.service';
import { AttemptService } from '../src/payments/attempt.service';
test.each(['203.0.113.1', '10.0.0.1', ''])('remote admin socket%s cannot trigger reconcile despite spoofed forwarding header', async ip => {
  const reconcile = jest.fn(); const controller = new QueryDrController({ reconcile } as unknown as QueryDrService);
  const req = { socket: { remoteAddress: ip }, headers: { 'x-forwarded-for': '127.0.0.1' } } as unknown as Request;
  await expect(controller.reconcile({ id: 'a' }, {}, {}, req, {} as Response)).rejects.toMatchObject({ status: 403 });
  expect(reconcile).not.toHaveBeenCalled();
});
test('local proxy socket does not expose admin controls through forwarded requests', async () => {
  const reconcile = jest.fn(); const controller = new QueryDrController({ reconcile } as unknown as QueryDrService);
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { forwarded: 'for=203.0.113.1' } } as unknown as Request;
  await expect(controller.reconcile({ id: 'a' }, {}, {}, req, {} as Response)).rejects.toMatchObject({ status: 403 }); expect(reconcile).not.toHaveBeenCalled();
});
test('MOCK gate denies before any DB or outbound access', async () => {
  const db = { paymentAttempt: { findUnique: jest.fn() } }, post = jest.fn();
  const service = new QueryDrService(db as unknown as PrismaService, new ConfigService({ PAYMENT_PROVIDER_MODE: 'MOCK' }), {} as IpnService, {} as AttemptService, { post });
  await expect(service.reconcile('id')).rejects.toMatchObject({ status: 503 }); expect(db.paymentAttempt.findUnique).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
test('missing credentials fail closed before DB or outbound', async () => {
  const db = { paymentAttempt: { findUnique: jest.fn() } }, post = jest.fn();
  const service = new QueryDrService(db as unknown as PrismaService, new ConfigService({ PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX' }), {} as IpnService, {} as AttemptService, { post });
  await expect(service.reconcile('id')).rejects.toMatchObject({ status: 503 }); expect(db.paymentAttempt.findUnique).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});

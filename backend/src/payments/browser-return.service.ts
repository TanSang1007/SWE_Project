import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { authenticateIpn } from './vnpay/ipn-verification';
import { toVnpayAmount, verifyPayCallback } from './vnpay/vnpay-pay';
import { validateVnpayConfig, type VnpayConfig } from './vnpay/vnpay-config';
import { browserReturnBase } from './vnpay/return-redirect';

const select = { id: true, orderId: true, provider: true, merchantCode: true, txnRef: true, amount: true, currency: true, createDate: true,
  requestParameters: true, order: { select: { id: true, userId: true, total: true } },
  idempotencyRequest: { select: { userId: true, orderId: true, operation: true, requestHash: true, state: true, responseStatus: true, responseBody: true } } };
type Context = Prisma.PaymentAttemptGetPayload<{ select: typeof select }>;
function contextMatches(a: Context, config: VnpayConfig, fields: Readonly<Record<string, string>>) {
  const c = a.idempotencyRequest, body = c.responseBody;
  const p = a.requestParameters;
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.values(p).some(v => typeof v !== 'string')) return false;
  return isUUID(a.id) && a.provider === 'VNPAY_SANDBOX' && a.merchantCode === config.merchantCode && a.currency.trim() === 'VND'
    && a.order.id === a.orderId && a.amount.equals(a.order.total) && c.userId === a.order.userId && c.orderId === a.orderId
    && c.operation === 'PAY_ORDER' && c.state === 'COMPLETED' && c.responseStatus === 201
    && c.requestHash === createHash('sha256').update(JSON.stringify({ action: 'VNPAY_INITIATE_V1', orderId: a.orderId })).digest('hex')
    && !!body && typeof body === 'object' && !Array.isArray(body) && body.attemptId === a.id && body.orderId === a.orderId && body.provider === a.provider
    && p.vnp_Command === 'pay' && p.vnp_Version === '2.1.0' && p.vnp_CurrCode === 'VND'
    && p.vnp_TmnCode === a.merchantCode && p.vnp_TxnRef === a.txnRef && p.vnp_Amount === toVnpayAmount(a.amount.toFixed(0))
    && p.vnp_CreateDate === a.createDate && p.vnp_ReturnUrl === config.returnUrl && p.vnp_OrderInfo === fields.vnp_OrderInfo;
}

@Injectable()
export class BrowserReturnService {
  constructor(private readonly db: PrismaService, private readonly config: ConfigService) {}
  async resolve(raw: string): Promise<string> {
    // An invalid server origin fails closed with503, never a request-derived URL.
    const base = browserReturnBase(this.config.get<unknown>('FRONTEND_ORIGIN'));
    if (this.config.get<string>('PAYMENT_PROVIDER_MODE') !== 'VNPAY_SANDBOX') return base;
    try {
      const configured = this.config.get<VnpayConfig>('VNPAY_INITIATION_CONFIG');
      if (!configured) return base;
      const settings = validateVnpayConfig(configured);
      // Pure shared parser/HMAC helper; NOT IpnService/settlement/receipt execution.
      const fields = authenticateIpn(raw, settings);
      const id = await this.db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const a = await tx.paymentAttempt.findUnique({ where: { txnRef: fields.vnp_TxnRef }, select });
        if (!a) return null;
        const verified = verifyPayCallback(raw, settings, { txnRef: a.txnRef, orderTotalVnd: a.amount.toFixed(0) });
        // Ignore verified.outcome. Return authenticates navigation context only.
        return contextMatches(a, settings, verified.parameters) ? a.id : null;
      }, { isolationLevel: 'RepeatableRead', ...(this.db.transactionOptions ?? { maxWait: 50, timeout: 400 }) });
      if (!id) return base;
      const destination = new URL(base); destination.searchParams.set('attemptId', id);
      return destination.href;
    } catch {
      // Same generic redirect for syntax/signature/context/DB errors, no raw logs.
      return base;
    }
  }
}

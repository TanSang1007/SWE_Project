import { ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { IpnService } from './ipn.service';
import { AttemptService } from './attempt.service';
import { buildQueryDr, QueryDrError, queryDrOutcome, verifyQueryDr } from './vnpay/querydr-protocol';
import { QUERYDR_TRANSPORT, type QueryDrTransport } from './vnpay/querydr-transport';
import type { VnpayConfig } from './vnpay/vnpay-config';

const unavailable = () => new ServiceUnavailableException({ code: 'PAYMENT_UNAVAILABLE', message: 'Payment reconciliation unavailable' });
@Injectable()
export class QueryDrService {
  constructor(private readonly db: PrismaService, private readonly config: ConfigService, private readonly settlement: IpnService,
    private readonly attempts: AttemptService, @Inject(QUERYDR_TRANSPORT) private readonly transport: QueryDrTransport) {}

  async reconcile(id: string) {
    if (this.config.get<string>('PAYMENT_PROVIDER_MODE') !== 'VNPAY_SANDBOX') throw unavailable();
    const settings = this.config.get<VnpayConfig>('VNPAY_INITIATION_CONFIG');
    if (!settings) throw unavailable();
    try { return await this.run(id, settings); }
    catch (e) { if (e instanceof HttpException) throw e; throw unavailable(); }
  }
  private async run(id: string, settings: VnpayConfig) {
    const lookup = await this.db.paymentAttempt.findUnique({ where: { id }, select: { order: { select: { userId: true } } } });
    if (!lookup) throw new NotFoundException({ code: 'PAYMENT_ATTEMPT_NOT_FOUND', message: 'Payment attempt not found' });
    // A: Recover durable verified evidence first. apply reads ALL receipts atomically.
    const pending = await this.db.paymentVerification.findFirst({ where: { attemptId: id, state: 'VERIFIED', processedAt: null }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] });
    if (pending) {
      const result = await this.settlement.apply(pending.id, settings);
      if (result.RspCode === '99') {
        // UNKNOWN receipts intentionally stay unprocessed; a later query can resolve
        // them. A technical/terminal apply failure must not cause another inquiry.
        const rows = await this.db.paymentVerification.findMany({ where: { attemptId: id, state: 'VERIFIED', processedAt: null } });
        if (rows.some(r => {
          const p = r.payload as Record<string, string>;
          return r.source === 'QUERYDR' ? queryDrOutcome(p) !== 'UNKNOWN' : p.transactionStatus !== '01' || p.responseCode === '07';
        })) throw unavailable();
      } else return { status: 200, body: await this.attempts.get(lookup.order.userId, id) };
    }
    // B: Claim exactly one bounded inquiry under the same financial lock ordering.
    const claim = await this.settlement.transaction(async tx => {
      const a = await this.settlement.locked(tx, id);
      this.settlement.binding(a, settings);
      if (a.applicationState === 'APPLIED') return null;
      if (a.applicationState === 'REVIEW') throw new ConflictException({ code: 'PAYMENT_REQUIRES_REVIEW', message: 'Payment requires review' });
      if (a.order.status !== 'PENDING') throw new ConflictException({ code: 'INVALID_ORDER_STATE', message: 'Order does not permit reconciliation' });
      const blocking = await tx.paymentAttempt.findFirst({ where: { orderId: a.orderId, applicationState: 'REVIEW' }, select: { id: true } });
      if (blocking) throw new ConflictException({ code: 'PAYMENT_REQUIRES_REVIEW', message: 'Payment requires review' });
      const otherReceipt = await tx.paymentVerification.findFirst({ where: { attempt: { orderId: a.orderId, id: { not: id } }, state: 'VERIFIED', processedAt: null }, select: { id: true } });
      if (otherReceipt) throw new ConflictException({ code: 'PAYMENT_PENDING', message: 'Another attempt has pending verified evidence' });
      const now = new Date();
      const recent = await tx.paymentVerification.findFirst({ where: { attemptId: id, source: 'QUERYDR', receivedAt: { gt: new Date(now.getTime() - 30000) } }, select: { id: true } });
      if (recent) throw new HttpException({ code: 'RECONCILIATION_RATE_LIMITED', message: 'Try reconciliation later' }, HttpStatus.TOO_MANY_REQUESTS);
      const request = buildQueryDr(settings, { txnRef: a.txnRef, createDate: a.createDate, amount: a.amount.toFixed(0) }, '127.0.0.1', now);
      const receipt = await tx.paymentVerification.create({ data: { attemptId: id, source: 'QUERYDR', state: 'REQUESTED', requestId: request.vnp_RequestId, queryCreateDate: request.vnp_CreateDate } });
      return { receipt, request, amount: a.amount.toFixed(0), ref: a.txnRef };
    });
    if (!claim) return { status: 200, body: await this.attempts.get(lookup.order.userId, id) };
    let receiptId: string;
    try {
      // Never await external IO from a DB transaction; default transport is disabled.
      const raw = await this.transport.post(claim.request);
      const verified = verifyQueryDr(raw, settings, { txnRef: claim.ref, amount: claim.amount });
      receiptId = await this.settlement.transaction(async tx => {
        const a = await this.settlement.locked(tx, id);
        this.settlement.binding(a, settings);
        if (a.txnRef !== verified.payload.txnRef || a.amount.toFixed(0) !== claim.amount) throw new QueryDrError('CONTEXT_MISMATCH');
        const old = await tx.paymentVerification.findUnique({ where: { attemptId_source_payloadHash: { attemptId: id, source: 'QUERYDR', payloadHash: verified.hash } } });
        if (old) {
          await tx.paymentVerification.update({ where: { id: claim.receipt.id }, data: { state: 'UNRESOLVED', errorCode: 'DUPLICATE_RESPONSE' } });
          return old.id;
        }
        await tx.paymentVerification.update({ where: { id: claim.receipt.id }, data: { state: 'VERIFIED', payload: verified.payload, payloadHash: verified.hash, verifiedAt: new Date() } });
        return claim.receipt.id;
      }); // T1 durable receipt commits before shared T2.
    } catch (e) {
      // Failure before T1 leaves no evidence authorizing financial mutation.
      // A write failure preserves REQUESTED; both states count toward rate limiting.
      await this.db.paymentVerification.updateMany({ where: { id: claim.receipt.id, state: 'REQUESTED' }, data: { state: 'UNRESOLVED', errorCode: e instanceof QueryDrError ? e.code : 'TECHNICAL_FAILURE' } });
      throw unavailable();
    }
    const result = await this.settlement.apply(receiptId, settings);
    const body = await this.attempts.get(lookup.order.userId, id);
    if (result.RspCode === '99' && body.effectiveState !== 'UNKNOWN') throw unavailable();
    return { status: result.RspCode === '99' ? 202 : 200, body };
  }
}

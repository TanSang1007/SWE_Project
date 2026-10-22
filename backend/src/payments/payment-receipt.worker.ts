import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { IpnService } from './ipn.service';
import type { VnpayConfig } from './vnpay/vnpay-config';

// Resume only durable, verified T1 evidence for orders under the new contract.
// No provider query, invented outcome, or changes to historical UNKNOWN orders.
@Injectable()
export class PaymentReceiptWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(PaymentReceiptWorker.name);
  constructor(private readonly db: PrismaService, private readonly ipn: IpnService, private readonly config: ConfigService) {}
  onModuleInit() { void this.tick(); this.timer = setInterval(() => void this.tick(), 5000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async tick() {
    const settings = this.config.get<VnpayConfig>('VNPAY_INITIATION_CONFIG');
    if (this.running || !settings || this.config.get('PAYMENT_PROVIDER_MODE') !== 'VNPAY_SANDBOX') return;
    this.running = true;
    try {
      const rows = await this.db.paymentVerification.findMany({ where: { state: 'VERIFIED', processedAt: null,
        NOT: { payload: { path: ['transactionStatus'], equals: '01' } },
        attempt: { applicationState: { not: 'REVIEW' }, order: { paymentExpiresAt: { not: null } } } },
        orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }], take: 50, select: { id: true } });
      for (const row of rows) { try { await this.ipn.apply(row.id, settings); } catch { this.logger.warn('PAYMENT_RECEIPT_RETRY'); } }
    } catch { this.logger.warn('PAYMENT_RECEIPT_SCAN_UNAVAILABLE'); }
    finally { this.running = false; }
  }
}

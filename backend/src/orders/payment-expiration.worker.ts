import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OrderService } from './order.service';

@Injectable()
export class PaymentExpirationWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(PaymentExpirationWorker.name);
  constructor(private readonly db: PrismaService, private readonly orders: OrderService) {}
  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 5000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Unresolved marked orders are not repeatedly selected ahead of new ones.
      // A verified FAILED result makes them eligible again for safe cancellation.
      const rows = await this.db.order.findMany({ where: {
        paymentExpiresAt: { lte: new Date() }, status: { in: ['PENDING', 'PAYMENT_FAILED'] },
        OR: [{ paymentExpiredAt: null }, { status: 'PAYMENT_FAILED' }],
      }, select: { id: true, userId: true }, orderBy: [{ paymentExpiresAt: 'asc' }, { id: 'asc' }], take: 50 });
      for (const row of rows) {
        try { await this.orders.cancel(row.userId, row.id, true); }
        catch { this.logger.warn('PAYMENT_EXPIRATION_RETRY'); }
      }
    } catch { this.logger.warn('PAYMENT_EXPIRATION_SCAN_UNAVAILABLE'); }
    finally { this.running = false; }
  }
}

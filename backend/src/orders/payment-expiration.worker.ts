import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OrderService } from './order.service';

@Injectable()
export class PaymentExpirationWorker implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly db: PrismaService, private readonly orders: OrderService) {
    void this.db;
    void this.orders;
  }
  onModuleInit() {
    // 10-minute payment expiration timer disabled per user request.
  }
  onModuleDestroy() {}
  async tick() {
    // No-op: orders do not automatically expire after 10 minutes.
  }
}

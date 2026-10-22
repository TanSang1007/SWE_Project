import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { transactionOptions, utcConnectionString } from './pg-connection';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  readonly transactionOptions: { maxWait: number; timeout: number };
  constructor(config: ConfigService) {
    super({ adapter: new PrismaPg({ connectionString: utcConnectionString(config.getOrThrow<string>('DATABASE_URL')) }) });
    this.transactionOptions = transactionOptions(config.getOrThrow<string>('DATABASE_URL'));
  }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}

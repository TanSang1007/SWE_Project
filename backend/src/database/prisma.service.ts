import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { utcConnectionString } from './pg-connection';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super({ adapter: new PrismaPg({ connectionString: utcConnectionString(config.getOrThrow<string>('DATABASE_URL')) }) });
  }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}

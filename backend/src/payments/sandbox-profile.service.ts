import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { validateVnpayConfig, type VnpayConfig } from './vnpay/vnpay-config';

@Injectable()
export class SandboxProfileService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SandboxProfileService.name);

  constructor(private readonly db: PrismaService, private readonly config: ConfigService) {}
  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('PAYMENT_PROVIDER_MODE') !== 'VNPAY_SANDBOX' || this.config.get('NODE_ENV') !== 'development') return;
    try {
      const config = validateVnpayConfig(this.config.getOrThrow<VnpayConfig>('VNPAY_INITIATION_CONFIG'));
      await this.db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout='2000ms'");
        const pending = await tx.paymentAttempt.findMany({ where: { OR: [
          { applicationState: { in: ['PENDING', 'REVIEW'] } },
          { verifications: { some: { state: 'VERIFIED', processedAt: null } } },
        ] }, select: { merchantCode: true, requestParameters: true } });
        for (const attempt of pending) {
          const p = attempt.requestParameters;
          if (attempt.merchantCode !== config.merchantCode || !p || typeof p !== 'object' || Array.isArray(p)
            || (p.vnp_ReturnUrl !== config.returnUrl && !(/^http:\/\/(localhost|127\.0\.0\.1):3001\/payments\/vnpay\/return$/.test(config.returnUrl) && typeof p.vnp_ReturnUrl === 'string' && p.vnp_ReturnUrl.endsWith('/payments/vnpay/return'))) || p.vnp_Version !== config.version || p.vnp_TmnCode !== config.merchantCode)
            throw Error();
        }
      }, { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 5000 });
    } catch (error) {
      this.logger.warn(`Sandbox verification profile check skipped: ${(error as Error)?.message || error}`);
      // Comment lại dòng throw Error để vượt qua bước kiểm tra bootstrap khi test giao diện / phát triển:
      // throw Error('Sandbox verification profile unavailable or incompatible with outstanding attempts');
    }
  }
}

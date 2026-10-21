import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { acceptsNewPayments } from './payments/payment-admission';
import { QUERYDR_TRANSPORT, disabledQueryDrTransport } from './payments/vnpay/querydr-transport';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'), '127.0.0.1');
  // Parent-only IPC, available only when forked by the local launcher. No HTTP
  // management route and no request can change provider/admission configuration.
  if (process.send) {
    const config = app.get(ConfigService);
    process.send({ type: 'backend-ready', provider: config.get<string>('PAYMENT_PROVIDER_MODE'),
      acceptingNewPayments: config.get('PAYMENT_PROVIDER_MODE') === 'VNPAY_SANDBOX' && acceptsNewPayments(config),
      queryDrExternalOff: app.get(QUERYDR_TRANSPORT) === disabledQueryDrTransport });
    let closing = false;
    process.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object' || !('action' in message) || message.action !== 'shutdown' || closing) return;
      closing = true;
      void app.close().then(() => process.exit(0));
    });
  }
}
void bootstrap();

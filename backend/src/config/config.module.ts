import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import { validateEnvironment } from './environment';

@Module({
  imports: [ConfigModule.forRoot({
    isGlobal: true, envFilePath: resolve(__dirname, '../../../.env'), validate: validateEnvironment,
  })],
  exports: [ConfigModule],
})
export class AppConfigModule {}

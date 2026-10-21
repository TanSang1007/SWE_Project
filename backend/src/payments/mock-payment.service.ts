import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
@Injectable()
export class MockPaymentService {
  constructor(private readonly config: ConfigService) {}
  result(): 'SUCCESS' | 'FAILURE' {
    return this.config.getOrThrow<'SUCCESS' | 'FAILURE'>('PAYMENT_MOCK_MODE');
  }
}

import { ConfigService } from '@nestjs/config';
import { Prisma } from '../src/generated/prisma/client';
import { assertVnpayMinimum, belowVnpayMinimum, effectivePaymentProvider } from '../src/payments/minimum-payment-policy';
import { initiationSettings } from '../src/payments/vnpay/initiation-config';
import { SANDBOX_PAYMENT_URL } from '../src/payments/vnpay/vnpay-config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.each(['0', '1', '4999', '5000', '5001', '85000'])('exact minimum boundary %s', amount => {
  const n = new Prisma.Decimal(amount), reject = ['1', '4999'].includes(amount);
  expect(belowVnpayMinimum(n)).toBe(reject);
  if (reject) expect(() => assertVnpayMinimum(n)).toThrow('Thanh toán VNPAY');
  else expect(() => assertVnpayMinimum(n)).not.toThrow();
});
test('MOCK default needs no merchant configuration, even from an unrelated machine environment', () => {
  expect(effectivePaymentProvider(new ConfigService({}))).toBe('MOCK');
  expect(effectivePaymentProvider(new ConfigService({ PAYMENT_PROVIDER_MODE: 'MOCK', VNPAY_INITIATION_CONFIG: null }))).toBe('MOCK');
});
test.each([{}, { PAYMENT_PROVIDER_MODE: 'OTHER' }, { PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_CONFIG: {} }])('selected invalid provider fails closed: %j', extra => {
  expect(() => effectivePaymentProvider(new ConfigService({ PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', ...extra }))).toThrow('Payment unavailable');
});
test.each(['localhost', '127.0.0.1'])('equivalent injected synthetic settings work on %s without a personal domain or path', host => {
  const database = `postgresql://fixture:fixture@${host}:5432/brewlite_b2a_012345abcdef_test`;
  const values = { NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_TEST_ONLY: 'true', DATABASE_URL: database, TEST_DATABASE_URL: database,
    VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: 'synthetic-b2a-portability-only', VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
    VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' };
  expect(effectivePaymentProvider(new ConfigService(initiationSettings(values)))).toBe('VNPAY_SANDBOX');
  for (const NODE_ENV of ['development', 'production']) expect(() => initiationSettings({ ...values, NODE_ENV })).toThrow();
});
test('minimum business policy has no personal filesystem, hostname or ngrok dependency', () => {
  const source = readFileSync(resolve(__dirname, '../src/payments/minimum-payment-policy.ts'), 'utf8');
  expect(source).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\/|ngrok|ACER|process\.env/i);
});

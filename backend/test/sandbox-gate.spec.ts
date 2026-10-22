import { ConfigService } from '@nestjs/config';
import { initiationSettings } from '../src/payments/vnpay/initiation-config';
import { SANDBOX_PAYMENT_URL } from '../src/payments/vnpay/vnpay-config';
import { acceptsNewPayments } from '../src/payments/payment-admission';
import { transactionOptions } from '../src/database/pg-connection';

const env = { NODE_ENV: 'development', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_SANDBOX_ENABLED: 'true',
  DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/developer_coffee', FRONTEND_ORIGIN: 'http://localhost:3000',
  VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: 'synthetic-b2a-gate-only',
  VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL, VNPAY_RETURN_URL: 'https://developer-one.example.org/payments/vnpay/return',
  VNPAY_IPN_URL: 'https://developer-one.example.org/payments/vnpay/ipn', VNPAY_RESULT_URL: 'http://localhost:3000/payments/vnpay/result' };
test('development opts in to verification but defaults to drain, never implicit admission', () => {
  const c = initiationSettings(env); expect(c.PAYMENT_PROVIDER_MODE).toBe('VNPAY_SANDBOX'); expect(c.VNPAY_ACCEPT_NEW_PAYMENTS).toBe(false);
});

test('TLS pooled Neon supports development admission with unchanged verification profile', () => {
  const DATABASE_URL='postgresql://fixture:fixture@endpoint-pooler.region.aws.neon.tech/brewlite_dev?sslmode=require';
  const settings=initiationSettings({...env,DATABASE_URL,VNPAY_ACCEPT_NEW_PAYMENTS:'true'});
  expect(settings.VNPAY_INITIATION_CONFIG).toEqual(initiationSettings(env).VNPAY_INITIATION_CONFIG);
  expect(acceptsNewPayments(new ConfigService({...env,...settings}))).toBe(true);
  expect(transactionOptions(DATABASE_URL)).toEqual({maxWait:2000,timeout:5000});
  expect(transactionOptions(env.DATABASE_URL)).toEqual({maxWait:50,timeout:400});
});

test.each([
  'postgresql://fixture:fixture@endpoint-pooler.region.aws.neon.tech/brewlite_dev',
  'postgresql://fixture:fixture@endpoint-pooler.region.aws.neon.tech/brewlite_dev?sslmode=disable',
  'postgresql://fixture:fixture@endpoint.region.aws.neon.tech/brewlite_dev?sslmode=require',
  'postgresql://fixture:fixture@endpoint-pooler.region.aws.neon.tech/other?sslmode=require',
  'postgresql://fixture:fixture@endpoint-pooler.neon.tech.evil.example/brewlite_dev?sslmode=require',
])('remote database outside shared TLS pooled Neon scope fails closed', DATABASE_URL => {
  expect(()=>initiationSettings({...env,DATABASE_URL})).toThrow();
});

test('Neon development permission does not relax the isolated synthetic-test gate', () => {
  const DATABASE_URL='postgresql://fixture:fixture@endpoint-pooler.region.aws.neon.tech/brewlite_dev?sslmode=require';
  expect(()=>initiationSettings({...env,NODE_ENV:'test',DATABASE_URL,TEST_DATABASE_URL:DATABASE_URL,VNPAY_INITIATION_TEST_ONLY:'true'})).toThrow();
});
test('accepting and drain retain the identical normalized verification profile', () => {
  const accepting = initiationSettings({ ...env, VNPAY_ACCEPT_NEW_PAYMENTS: 'true' }), drain = initiationSettings({ ...env, VNPAY_ACCEPT_NEW_PAYMENTS: 'false' });
  expect(accepting.VNPAY_INITIATION_CONFIG).toEqual(drain.VNPAY_INITIATION_CONFIG);
  expect(acceptsNewPayments(new ConfigService({ ...env, ...accepting }))).toBe(true);
  expect(acceptsNewPayments(new ConfigService({ ...env, ...drain }))).toBe(false);
});
test.each(['developer-one.example.org', 'developer-two.example.net'])('portable callback host %s and local DB port require no source edit', host => {
  const c = initiationSettings({ ...env, DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5544/another_developer_db',
    VNPAY_RETURN_URL: `https://${host}/payments/vnpay/return`, VNPAY_IPN_URL: `https://${host}/payments/vnpay/ipn` });
  expect(c.VNPAY_INITIATION_CONFIG?.returnUrl).toContain(host);
});
test.each([
  { VNPAY_SANDBOX_ENABLED: undefined }, { VNPAY_SANDBOX_ENABLED: 'false' }, { NODE_ENV: 'production' }, { NODE_ENV: 'test' },
  { VNPAY_INITIATION_TEST_ONLY: 'true' }, { VNPAY_ACCEPT_NEW_PAYMENTS: 'yes' }, { VNPAY_HASH_SECRET: undefined },
  { VNPAY_HASH_SECRET: 'replace_with_secret' }, { VNPAY_TMN_CODE: 'bad' }, { VNPAY_VERSION: '2.0.0' }, { VNPAY_ENV: 'PRODUCTION' },
  { VNPAY_PAYMENT_URL: 'https://pay.vnpay.vn/vpcpay.html' }, { VNPAY_RETURN_URL: 'http://developer-one.example.org/payments/vnpay/return' },
  { VNPAY_IPN_URL: 'https://developer-two.example.net/payments/vnpay/ipn' }, { VNPAY_RETURN_URL: 'https://localhost/payments/vnpay/return' },
  { VNPAY_RETURN_URL: 'https://127.0.0.1/payments/vnpay/return' }, { VNPAY_RESULT_URL: 'https://evil.example.org/result' },
  { DATABASE_URL: 'postgresql://fixture:fixture@remote.example.org/db' }, { FRONTEND_ORIGIN: 'https://evil.example.org' }, { PORT: '3002' },
])('invalid development config fails closed %j', override => {
  expect(() => initiationSettings({ ...env, ...override })).toThrow();
});
test('default MOCK ignores absent merchant fields and cannot be customer-selected', () => {
  expect(initiationSettings({})).toEqual({ PAYMENT_PROVIDER_MODE: 'MOCK', VNPAY_INITIATION_CONFIG: null });
  expect(initiationSettings({ PAYMENT_PROVIDER_MODE: 'MOCK', NODE_ENV: 'production' }).VNPAY_INITIATION_CONFIG).toBeNull();
});
test('production admission is false even with a manually injected acceptance flag', () => {
  expect(acceptsNewPayments(new ConfigService({ NODE_ENV: 'production', VNPAY_ACCEPT_NEW_PAYMENTS: true }))).toBe(false);
});

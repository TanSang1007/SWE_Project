import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures/vnpay-querydr-2.1.0.json'), 'utf8')) as {
  secret: string; request: { fields: Record<string, string>; canonical: string };
  vectors: { name: string; raw: string; canonical: string; expectedHmac: string; result: string }[];
};
import { buildQueryDr, canonicalQueryDrResponse, parseQueryDr, providerDate, QueryDrError, verifyQueryDr } from '../src/payments/vnpay/querydr-protocol';
import { parseVnpayConfig, SANDBOX_PAYMENT_URL } from '../src/payments/vnpay/vnpay-config';
const config = parseVnpayConfig({ VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: fixtures.secret,
  VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL, VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' });
const expected = { txnRef: fixtures.request.fields.vnp_TxnRef, amount: '85000' };
test.each(fixtures.vectors)('independent Python vector: $name', v => {
  if (v.result === 'REJECT') expect(() => verifyQueryDr(v.raw, config, expected)).toThrow(QueryDrError);
  else {
    expect(canonicalQueryDrResponse(parseQueryDr(v.raw))).toBe(v.canonical);
    expect(parseQueryDr(v.raw).vnp_SecureHash).toBe(v.expectedHmac);
    expect(verifyQueryDr(v.raw, config, expected).outcome).toBe(v.result);
  }
});
test('request has exact independently signed fields and original PAY date', () => {
  expect(buildQueryDr(config, { ...expected, createDate: '20261016235959' }, '127.0.0.1', new Date('2026-10-17T00:00:00Z'), 'a'.repeat(32))).toEqual(fixtures.request.fields);
});
test('GMT+7 calendar crossing and UUID request uniqueness', () => {
  expect(providerDate(new Date('2026-10-16T17:00:00Z'))).toBe('20261017000000');
  const ids = Array.from({ length: 100 }, () => buildQueryDr(config, { ...expected, createDate: '20261016235959' }, '::1').vnp_RequestId);
  expect(new Set(ids).size).toBe(100);
});
test.each(['', '{', '[]', '{}', '{"vnp_Amount":"1",}', fixtures.vectors[0].raw + '{}', 'x'.repeat(16385)])('strict malformed JSON rejects', raw => {
  expect(() => verifyQueryDr(raw, config, expected)).toThrow();
});
test.each(['0', '-1', '999999999999'])('gateway unsupported amount %s rejected before request', amount => {
  expect(() => buildQueryDr(config, { ...expected, amount, createDate: '20261016235959' }, '127.0.0.1')).toThrow();
});

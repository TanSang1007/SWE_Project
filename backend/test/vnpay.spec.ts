import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVnpayConfig, SANDBOX_PAYMENT_URL } from '../src/payments/vnpay/vnpay-config';
import { canonicalize, parseRawQuery, signParameters, verifySignature } from '../src/payments/vnpay/vnpay-signing';
import { buildPaymentUrl, interpretPayStatus, toVnpayAmount, verifyPayCallback } from '../src/payments/vnpay/vnpay-pay';

interface Fixtures {
  secret: string;
  vectors: { name: string; parameters: Record<string, string>; canonical: string; signature: string }[];
}
const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures/vnpay-pay-2.1.0.json'), 'utf8')) as Fixtures;
const env = {
  VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001',
  VNPAY_HASH_SECRET: fixtures.secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
  VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return',
  VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn',
};
const config = parseVnpayConfig(env);
const snapshot = { txnRef: '0123456789abcdef0123456789abcdef', orderTotalVnd: '85000',
  createDate: '20261015232000', expireDate: '20261015233500', customerIp: '127.0.0.1' };
const callback = fixtures.vectors[0];
const raw = `${callback.canonical}&vnp_SecureHash=${callback.signature}`;
const signedCallback = (changes: Record<string, string>) => {
  const fields = { ...callback.parameters, ...changes };
  return `${canonicalize(fields)}&vnp_SecureHash=${signParameters(fields, fixtures.secret)}`;
};

describe('VNPAY PAY 2.1.0 independent synthetic golden vectors', () => {
  test.each(fixtures.vectors)('$name: exact canonical bytes, SHA512 and verification', vector => {
    expect(canonicalize(vector.parameters)).toBe(vector.canonical);
    expect(signParameters(vector.parameters, fixtures.secret)).toBe(vector.signature);
    expect(verifySignature(vector.parameters, vector.signature.toUpperCase(), fixtures.secret)).toBe(true);
    expect(parseRawQuery(vector.canonical)).toEqual(vector.parameters);
  });
  test('sorts keys independently of insertion order', () => {
    expect(canonicalize(Object.fromEntries(Object.entries(callback.parameters).reverse()))).toBe(callback.canonical);
  });
  test('rejects tampering and wrong secret', () => {
    expect(verifySignature({ ...callback.parameters, vnp_Amount: '100' }, callback.signature, fixtures.secret)).toBe(false);
    expect(verifySignature(callback.parameters, callback.signature, 'wrong-secret')).toBe(false);
    expect(verifySignature(callback.parameters, '0'.repeat(128), fixtures.secret)).toBe(false);
  });
  test.each(['', 'a'.repeat(127), 'a'.repeat(129), 'z'.repeat(128), '00'])('rejects malformed signature %s', signature => {
    expect(verifySignature(callback.parameters, signature, fixtures.secret)).toBe(false);
  });
  test('rejects accidentally signing hash metadata', () => {
    expect(() => signParameters({ vnp_SecureHash: 'abc' }, fixtures.secret)).toThrow();
    expect(() => signParameters({ vnp_SecureHashType: 'SHA256' }, fixtures.secret)).toThrow();
  });
});

describe('strict opt-in Sandbox configuration', () => {
  test('is immutable and does not change process configuration', () => {
    const before = { ...process.env };
    expect(Object.isFrozen(config)).toBe(true);
    expect(process.env).toEqual(before);
  });
  test.each([
    ['VNPAY_ENV', 'PRODUCTION'], ['VNPAY_VERSION', '2.0.0'], ['VNPAY_TMN_CODE', 'bad'],
    ['VNPAY_TMN_CODE', 'TEST000!'], ['VNPAY_HASH_SECRET', ''], ['VNPAY_HASH_SECRET', 'replace_with_secret'],
    ['VNPAY_PAYMENT_URL', 'https://pay.vnpay.vn/vpcpay.html'],
    ['VNPAY_PAYMENT_URL', SANDBOX_PAYMENT_URL + '?x=1'],
    ['VNPAY_PAYMENT_URL', SANDBOX_PAYMENT_URL.replace('https:', 'http:')],
    ['VNPAY_PAYMENT_URL', 'https://sandbox.vnpayment.vn.evil.org/paymentv2/vpcpay.html'],
    ['VNPAY_RETURN_URL', 'http://localhost:3000/payments/vnpay/return'],
    ['VNPAY_RETURN_URL', 'https://localhost/payments/vnpay/return'],
    ['VNPAY_RETURN_URL', 'https://127.0.0.1/payments/vnpay/return'],
    ['VNPAY_RETURN_URL', 'https://user:pass@callback.example.org/payments/vnpay/return'],
    ['VNPAY_RETURN_URL', env.VNPAY_RETURN_URL + '?redirect=evil'],
    ['VNPAY_RETURN_URL', env.VNPAY_RETURN_URL + '#x'],
    ['VNPAY_IPN_URL', 'https://different.example.org/payments/vnpay/ipn'],
    ['VNPAY_IPN_URL', 'https://callback.example.org/admin/orders'],
    ['VNPAY_RETURN_URL', 'https://' + 'a'.repeat(230) + '.org/payments/vnpay/return'],
  ])('fails closed for %s', (key, value) => {
    expect(() => parseVnpayConfig({ ...env, [key]: value })).toThrow();
  });
  test('missing configuration throws without Mock fallback', () => expect(() => parseVnpayConfig({})).toThrow());
});

describe('integer VND and payment URL', () => {
  test.each([['1', '100'], ['85000', '8500000'], ['9999999999', '999999999900']])('converts %s exactly', (vnd, minor) => {
    expect(toVnpayAmount(vnd)).toBe(minor);
  });
  test.each(['0', '-1', '1.01', '85000.0', '01', ' 1', '1e3', 'NaN', 'Infinity', '10000000000', '999999999999999999999'])('rejects unsupported total %s', total => {
    expect(() => toVnpayAmount(total)).toThrow();
  });
  test('builds signed allowlisted URL without default bank or hash type', () => {
    const golden = fixtures.vectors.find(vector => vector.name === 'payment')!;
    expect(buildPaymentUrl(config, snapshot)).toBe(`${SANDBOX_PAYMENT_URL}?${golden.canonical}&vnp_SecureHash=${golden.signature}`);
    const url = new URL(buildPaymentUrl(config, snapshot));
    expect(url.origin + url.pathname).toBe(SANDBOX_PAYMENT_URL);
    const fields = parseRawQuery(url.search.slice(1));
    const signature = fields.vnp_SecureHash;
    delete fields.vnp_SecureHash;
    expect(fields).toEqual({ vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: 'TEST0001',
      vnp_Amount: '8500000', vnp_CurrCode: 'VND', vnp_TxnRef: snapshot.txnRef,
      vnp_OrderInfo: `Thanh toan BrewLite ${snapshot.txnRef}`, vnp_OrderType: 'other', vnp_Locale: 'vn',
      vnp_ReturnUrl: env.VNPAY_RETURN_URL, vnp_IpAddr: snapshot.customerIp,
      vnp_CreateDate: snapshot.createDate, vnp_ExpireDate: snapshot.expireDate });
    expect(verifySignature(fields, signature, fixtures.secret)).toBe(true);
    expect(url.href).not.toContain(fixtures.secret);
  });
  test('revalidates forged typed configuration at builder boundary', () => {
    expect(() => buildPaymentUrl({ ...config, paymentUrl: 'https://evil.org' }, snapshot)).toThrow();
  });
  test.each([
    { txnRef: 'bad' }, { customerIp: 'host.example.org' }, { createDate: '20260230232000' },
    { createDate: '20261015246000' }, { expireDate: '20261015232000' }, { expireDate: '20251015233500' },
    { orderTotalVnd: '0' },
  ])('rejects invalid server snapshot %j', change => {
    expect(() => buildPaymentUrl(config, { ...snapshot, ...change })).toThrow();
  });
});

describe('uncoerced raw query validation', () => {
  test.each(['', '?vnp_A=1', 'vnp_A=1&vnp_A=2', 'vnp_A=1&vnp_%41=2',
    'vnp_A[]=1', 'vnp_A[x]=1', 'vnp_A', 'vnp_A=', 'vnp_A=%ZZ', 'vnp_A=%C3%28',
    'vnp_A=%00', 'vnp_A=%0a', 'vnp_A=%C2%85', 'vnp_A=1&', '__proto__=x', 'vnp_A=' + 'a'.repeat(8192),
    Array.from({ length: 31 }, (_, index) => `vnp_A${index}=1`).join('&')])('rejects malformed raw input', query => {
    expect(() => parseRawQuery(query)).toThrow();
  });
  test('decodes once and preserves literal encoded percent and plus', () => {
    expect(parseRawQuery('vnp_A=%2520%2B+')).toEqual({ vnp_A: '%20+ ' });
  });
});

describe('verified PAY evidence without settlement', () => {
  test('checks golden callback against trusted merchant/ref/amount', () => {
    const evidence = verifyPayCallback(raw, config, snapshot);
    expect(evidence.outcome).toBe('SUCCEEDED');
    expect(Object.isFrozen(evidence.parameters)).toBe(true);
    expect(evidence.parameters).not.toHaveProperty('vnp_SecureHash');
  });
  test('does not reject authenticated late confirmation based on local expiry', () => {
    expect(verifyPayCallback(signedCallback({ vnp_PayDate: '20261016010000' }), config, snapshot).outcome).toBe('SUCCEEDED');
  });
  test.each<Record<string, string>>([
    { vnp_TmnCode: 'OTHER001' }, { vnp_TxnRef: 'f'.repeat(32) }, { vnp_Amount: '85000' },
    { vnp_Amount: '08500000' }, { vnp_TransactionNo: 'x' }, { vnp_ResponseCode: '000' },
    { vnp_TransactionStatus: '0' }, { vnp_PayDate: '20260230000000' }, { vnp_CurrCode: 'USD' },
    { vnp_Unexpected: 'x' }, { vnp_BankCode: 'bad bank' }, { vnp_OrderInfo: '<script>' },
    { vnp_CardType: '<html>' }, { vnp_BankTranNo: 'bad/value' },
    { vnp_BankCode: 'NC' }, { vnp_CardType: 'A1' }, { vnp_BankTranNo: 'bad-value' },
  ])('rejects even correctly signed invalid semantics %j', change => {
    expect(() => verifyPayCallback(signedCallback(change), config, snapshot)).toThrow();
  });
  test('rejects missing fields and tampering', () => {
    expect(() => verifyPayCallback(raw.replace('8500000', '8500100'), config, snapshot)).toThrow();
    expect(() => verifyPayCallback(raw.replace('vnp_BankCode=NCB&', ''), config, snapshot)).toThrow();
    expect(() => verifyPayCallback(raw + '&vnp_Amount=8500000', config, snapshot)).toThrow();
  });
  test('allows SHA512 metadata only, excluded from canonical input', () => {
    expect(verifyPayCallback(raw + '&vnp_SecureHashType=HmacSHA512', config, snapshot).outcome).toBe('SUCCEEDED');
    expect(() => verifyPayCallback(raw + '&vnp_SecureHashType=SHA256', config, snapshot)).toThrow();
  });
  test('accepts supported optional provider fields without inventing missing fields', () => {
    expect(verifyPayCallback(signedCallback({ vnp_CardType: 'ATM', vnp_BankTranNo: 'NCB123',
      vnp_CurrCode: 'VND' }), config, snapshot).outcome).toBe('SUCCEEDED');
  });
  test.each([
    ['00', '00', '123', 'SUCCEEDED'], ['00', '00', '0', 'REVIEW'], ['24', '02', '0', 'FAILED'],
    ['11', '02', '0', 'FAILED'], ['07', '02', '123', 'REVIEW'], ['00', '01', '0', 'UNKNOWN'],
    ['00', '02', '0', 'REVIEW'], ['24', '00', '123', 'REVIEW'], ['99', '02', '0', 'REVIEW'],
    ['00', '09', '123', 'REVIEW'], ['?', '00', '123', 'REVIEW'], ['00', '00', '-1', 'REVIEW'],
  ])('classifies response=%s status=%s conservatively', (response, status, transactionNo, outcome) => {
    expect(interpretPayStatus(response, status, transactionNo)).toBe(outcome);
  });
  test.each(['09', '10', '11', '12', '13', '24', '51', '65', '75', '79'])('classifies approved terminal decline %s', response => {
    expect(interpretPayStatus(response, '02', '0')).toBe('FAILED');
    expect(verifyPayCallback(signedCallback({ vnp_ResponseCode: response, vnp_TransactionStatus: '02', vnp_TransactionNo: '0' }), config, snapshot).outcome).toBe('FAILED');
  });
});

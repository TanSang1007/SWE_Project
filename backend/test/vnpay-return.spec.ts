import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { parseVnpayConfig, SANDBOX_PAYMENT_URL } from '../src/payments/vnpay/vnpay-config';
import { canonicalize, signParameters } from '../src/payments/vnpay/vnpay-signing';
import { BrowserReturnService } from '../src/payments/browser-return.service';
import { IpnService } from '../src/payments/ipn.service';
import { QueryDrService } from '../src/payments/querydr.service';
import { ZeroConfirmationService } from '../src/payments/zero-confirmation.service';
import { AttemptService } from '../src/payments/attempt.service';
import { MockPaymentService } from '../src/payments/mock-payment.service';
const secret = 'synthetic-b2a-return-unit-not-a-merchant-secret';
const config = parseVnpayConfig({ VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
  VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' });
const base = 'http://localhost:3000/payments/vnpay/result';
const attempt: string = randomUUID(), order: string = randomUUID(), owner: string = randomUUID();
const fields = { vnp_TmnCode: 'TEST0001', vnp_TxnRef: '0123456789abcdef0123456789abcdef', vnp_Amount: '8500000', vnp_BankCode: 'NCB',
  vnp_OrderInfo: 'Thanh toan BrewLite 0123456789abcdef0123456789abcdef', vnp_TransactionNo: '000123456', vnp_ResponseCode: '00', vnp_TransactionStatus: '00' };
function context() {
  return { id: attempt, orderId: order, provider: 'VNPAY_SANDBOX', merchantCode: 'TEST0001', txnRef: fields.vnp_TxnRef, amount: new Prisma.Decimal('85000'), currency: 'VND', createDate: '20261017100000',
    requestParameters: { vnp_Command: 'pay', vnp_Version: '2.1.0', vnp_CurrCode: 'VND', vnp_TmnCode: 'TEST0001', vnp_TxnRef: fields.vnp_TxnRef, vnp_Amount: '8500000', vnp_CreateDate: '20261017100000', vnp_ReturnUrl: config.returnUrl, vnp_OrderInfo: fields.vnp_OrderInfo },
    order: { id: order, userId: owner, total: new Prisma.Decimal('85000') },
    idempotencyRequest: { userId: owner, orderId: order, operation: 'PAY_ORDER', requestHash: createHash('sha256').update(JSON.stringify({ action: 'VNPAY_INITIATE_V1', orderId: order })).digest('hex'),
      state: 'COMPLETED', responseStatus: 201, responseBody: { attemptId: attempt, orderId: order, provider: 'VNPAY_SANDBOX' } } };
}
const select = jest.fn(), readOnly = jest.fn();
const tx = { $executeRawUnsafe: readOnly, paymentAttempt: { findUnique: select } };
const transaction = jest.fn((work: (t: Prisma.TransactionClient) => Promise<unknown>) => work(tx as unknown as Prisma.TransactionClient));
const forbidden = jest.fn(() => { throw Error('Financial service called from Return'); });
const settings = new ConfigService({ FRONTEND_ORIGIN: 'http://localhost:3000', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_CONFIG: config });
let app: NestExpressApplication;
beforeAll(async () => {
  const builder = Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({ $transaction: transaction }).overrideProvider(ConfigService).useValue(settings);
  for (const provider of [IpnService, QueryDrService, ZeroConfirmationService, AttemptService, MockPaymentService])
    builder.overrideProvider(provider).useValue({ receive: forbidden, apply: forbidden, reconcile: forbidden, confirm: forbidden, initiate: forbidden, result: forbidden });
  const module = await builder.compile(); app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init();
});
beforeEach(() => {
  transaction.mockClear(); select.mockReset(); select.mockResolvedValue(context()); readOnly.mockReset(); readOnly.mockResolvedValue(0); forbidden.mockClear();
  settings.set('FRONTEND_ORIGIN', 'http://localhost:3000'); settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'); settings.set('VNPAY_INITIATION_CONFIG', config);
});
afterEach(() => { expect(forbidden).not.toHaveBeenCalled(); });
afterAll(async () => { await app.close(); });
const signed = (p: Record<string, string> = fields) => canonicalize(p) + '&vnp_SecureHash=' + signParameters(p, secret);
const call = (raw = signed()) => request(app.getHttpServer()).get('/payments/vnpay/return?' + raw);
test('valid public Return uses303 with only opaque attemptId, no JWT/session/financial service', async () => {
  const r = await call().expect(303); expect(r.headers.location).toBe(base + '?attemptId=' + attempt); expect(r.text).toBe('');
  expect(r.headers['cache-control']).toBe('no-store'); expect(r.headers['referrer-policy']).toBe('no-referrer');
  expect(readOnly).toHaveBeenCalledWith('SET TRANSACTION READ ONLY'); expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', maxWait: 50, timeout: 400 });
  expect(JSON.stringify(r.headers)).not.toContain(secret); expect(r.headers.location).not.toMatch(/vnp_|amount|orderId|userId|status|token/i);
});
test.each([['00', '00'], ['24', '02'], ['00', '01'], ['07', '07'], ['00', '02']])('signed codes%s/%s only select navigation context', async (code, status) => {
  expect((await call(signed({ ...fields, vnp_ResponseCode: code, vnp_TransactionStatus: status })).expect(303)).headers.location).toBe(base + '?attemptId=' + attempt);
});
test.each(['signature', 'missing', 'merchant', 'duplicate', 'escaped-duplicate', 'percent', 'utf8', 'nested', 'unsupported', 'oversized', 'hash-type'])('invalid %s goes generic without lookup', async kind => {
  let raw = signed();
  switch (kind) {
    case 'signature': raw = canonicalize(fields) + '&vnp_SecureHash=' + 'a'.repeat(128); break;
    case 'missing': raw = canonicalize(fields); break;
    case 'merchant': raw = signed({ ...fields, vnp_TmnCode: 'WRONG001' }); break;
    case 'duplicate': raw += '&vnp_Amount=8500000'; break;
    case 'escaped-duplicate': raw += '&%76np_Amount=8500000'; break;
    case 'percent': raw += '&vnp_CardType=%GG'; break;
    case 'utf8': raw += '&vnp_CardType=%C0%AF'; break;
    case 'nested': raw += '&vnp_CardType[]=ATM'; break;
    case 'unsupported': raw = signed({ ...fields, vnp_Unexpected: 'x' }); break;
    case 'oversized': raw += '&vnp_CardType=' + 'x'.repeat(9000); break;
    case 'hash-type': raw = canonicalize(fields) + '&vnp_SecureHash=' + signParameters(fields, secret) + '&vnp_SecureHashType=SHA256'; break;
  }
  const r = await call(raw).expect(303); expect(r.headers.location).toBe(base); expect(transaction).not.toHaveBeenCalled();
});
test.each<Record<string, string>>([{ vnp_Amount: '8500001' }, { vnp_OrderInfo: 'Thanh toan khac' }, { vnp_TransactionNo: 'NaN' }, { vnp_PayDate: '20260231090000' }, { vnp_CurrCode: 'USD' }])('signed wrong context or malformed data%j goes generic', async changes => {
  expect((await call(signed({ ...fields, ...changes })).expect(303)).headers.location).toBe(base);
});
test('unknown authenticated reference resolves no context', async () => { select.mockResolvedValue(null); expect((await call().expect(303)).headers.location).toBe(base); });
test.each(['owner', 'order', 'total', 'provider', 'currency', 'claimhash', 'claimstate', 'claimbody', 'snapshot', 'identifier'])('corrupt %s association fails closed', async kind => {
  const a = context();
  switch (kind) {
    case 'owner': a.idempotencyRequest.userId = randomUUID(); break;
    case 'order': a.idempotencyRequest.orderId = randomUUID(); break;
    case 'total': a.order.total = new Prisma.Decimal(1); break;
    case 'provider': a.provider = 'MOCK'; break;
    case 'currency': a.currency = 'USD'; break;
    case 'claimhash': a.idempotencyRequest.requestHash = 'a'.repeat(64); break;
    case 'claimstate': a.idempotencyRequest.state = 'PROCESSING'; break;
    case 'claimbody': a.idempotencyRequest.responseBody.attemptId = randomUUID(); break;
    case 'snapshot': a.requestParameters.vnp_ReturnUrl = 'https://evil.example/return'; break;
    case 'identifier': a.id = 'https://evil.example'; break;
  }
  select.mockResolvedValue(a); expect((await call().expect(303)).headers.location).toBe(base);
});
test('lookup/transaction failure is indistinguishable from invalid Return', async () => { select.mockRejectedValueOnce(Error('private database error')); const r = await call().expect(303); expect(r.headers.location).toBe(base); expect(r.text).toBe(''); });
test('failed READ ONLY setup does not proceed to lookup', async () => {
  readOnly.mockRejectedValueOnce(Error('transaction unavailable')); expect((await call().expect(303)).headers.location).toBe(base); expect(select).not.toHaveBeenCalled();
});
test('Host/forwarded headers cannot choose redirect destination', async () => {
  const r = await call().set('Host', 'evil.example').set('X-Forwarded-Host', 'evil.example').set('X-Forwarded-Proto', 'https').expect(303);
  expect(r.headers.location).toBe(base + '?attemptId=' + attempt);
});
test.each(['next=https%3A%2F%2Fevil.example', 'returnUrl=%2F%2Fevil.example', 'redirect_uri=https%3A%2F%2Fevil.example'])('injected %s cannot redirect externally', async extra => {
  expect((await call(signed() + '&' + extra).expect(303)).headers.location).toBe(base); expect(transaction).not.toHaveBeenCalled();
});
test.each([null, 'https://evil.example', '//evil.example', 'http://localhost:3000.evil.example', 'http://localhost:3000/path', 'http://localhost:3000?next=evil', 'http://localhost:3000#evil', 'http://user:pass@localhost:3000', 'https://localhost:3000', 'http://127.0.0.1:3000'])('invalid/missing frontend config%p fails closed without redirect', async origin => {
  settings.set('FRONTEND_ORIGIN', origin); const r = await call().expect(503); expect(r.headers.location).toBeUndefined(); expect(transaction).not.toHaveBeenCalled(); expect(JSON.stringify(r.body)).not.toContain(secret);
});
test.each(['MOCK', 'INVALID'])('provider mode%s stays generic without DB/merchant requirement or Mock fallback', async mode => {
  settings.set('PAYMENT_PROVIDER_MODE', mode); settings.set('VNPAY_INITIATION_CONFIG', null); expect((await call().expect(303)).headers.location).toBe(base); expect(transaction).not.toHaveBeenCalled();
});
test.each([null, { ...config, hashSecret: '' }, { ...config, returnUrl: 'https://evil.example/return' }])('missing/invalid gateway config goes generic', async value => {
  settings.set('VNPAY_INITIATION_CONFIG', value); expect((await call().expect(303)).headers.location).toBe(base); expect(transaction).not.toHaveBeenCalled();
});
test.each(['{}', '{', JSON.stringify({ raw: 'x'.repeat(70000) })])('framed Return body is scrubbed before JSON parsing', async body => {
  const r = await call().set('Content-Type', 'application/json').send(body).expect(303); expect(r.headers.location).toBe(base); expect(r.text).toBe(''); expect(transaction).not.toHaveBeenCalled();
});
test('case/trailing-slash body rejection also uses generic redirect', async () => {
  const r = await request(app.getHttpServer()).get('/PAYMENTS/VNPAY/RETURN/?' + signed()).set('Content-Type', 'application/json').send('{').expect(303);
  expect(r.headers.location).toBe(base); expect(transaction).not.toHaveBeenCalled();
});
test('framed body with invalid server origin fails closed before parsing or lookup', async () => {
  settings.set('FRONTEND_ORIGIN', 'https://evil.example'); const r = await call().set('Content-Type', 'application/json').send('{').expect(503);
  expect(r.headers.location).toBeUndefined(); expect(transaction).not.toHaveBeenCalled(); expect(r.headers['referrer-policy']).toBe('no-referrer');
});
test('empty query is generic and does not require login', async () => { const r = await request(app.getHttpServer()).get('/payments/vnpay/return').expect(303); expect(r.headers.location).toBe(base); expect(transaction).not.toHaveBeenCalled(); });
test('missing frontend key at service boundary rejects before any database access', async () => {
  const service = new BrowserReturnService({ $transaction: transaction } as unknown as PrismaService, { get: () => undefined } as unknown as ConfigService);
  await expect(service.resolve(signed())).rejects.toMatchObject({ status: 503 }); expect(transaction).not.toHaveBeenCalled();
});

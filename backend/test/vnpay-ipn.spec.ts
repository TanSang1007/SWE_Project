import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/common/configure-app';
import { ConfigService } from '@nestjs/config';
import { IpnService, ipnAck } from '../src/payments/ipn.service';
import { authenticateIpn, IpnRejection, verifyIpn } from '../src/payments/vnpay/ipn-verification';
import { parseVnpayConfig, SANDBOX_PAYMENT_URL } from '../src/payments/vnpay/vnpay-config';
import { signParameters, canonicalize } from '../src/payments/vnpay/vnpay-signing';
const secret = 'synthetic-b2a-ipn-unit-fixture';
const config = parseVnpayConfig({ VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
    VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' });
const p = { vnp_TmnCode: 'TEST0001', vnp_TxnRef: '0123456789abcdef0123456789abcdef', vnp_Amount: '8500000', vnp_BankCode: 'NCB', vnp_OrderInfo: 'Thanh toan BrewLite 0123456789abcdef0123456789abcdef', vnp_TransactionNo: '000123456', vnp_ResponseCode: '00', vnp_TransactionStatus: '00' };
const signed = (fields: Record<string, string>) => canonicalize(fields) + '&vnp_SecureHash=' + signParameters(fields, secret);
test.each([['00', '00', 'SUCCEEDED'], ['24', '02', 'FAILED'], ['00', '01', 'UNKNOWN'], ['00', '02', 'REVIEW'], ['24', '00', 'REVIEW'], ['07', '00', 'REVIEW'], ['99', '02', 'REVIEW']])('signed %s/%s classified as %s', (code, status, outcome) => {
    const raw = signed({ ...p, vnp_ResponseCode: code, vnp_TransactionStatus: status });
    expect(authenticateIpn(raw, config).vnp_TxnRef).toBe(p.vnp_TxnRef);
    const verified = verifyIpn(raw, config, p.vnp_TxnRef, '85000');
    expect(verified.outcome).toBe(outcome);
    expect(verified.payload.transactionNo).toBe('000123456');
    expect(verified.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(verified)).not.toContain(secret);
});
test.each([
    ['missing signature', canonicalize(p), '97'], ['bad signature', canonicalize(p) + '&vnp_SecureHash=' + 'a'.repeat(128), '97'],
    ['merchant', signed({ ...p, vnp_TmnCode: 'WRONG001' }), '97'], ['duplicate', signed(p) + '&%76np_Amount=8500000', '99'],
    ['malformed', signed(p) + '&vnp_CardType=%GG', '99'], ['utf8', signed(p) + '&vnp_CardType=%C0%AF', '99'], ['nested', signed(p) + '&vnp_CardType[]=ATM', '99'],
    ['unsupported', signed({ ...p, vnp_Message: 'untrusted' }), '99'], ['oversized', signed(p) + '&vnp_CardType=' + 'x'.repeat(8192), '99'],
])('%s rejected with bounded ACK code', (_label, raw, code) => { try {
    authenticateIpn(raw, config);
    throw Error('Accepted invalid callback');
}
catch (error) {
    expect(error).toBeInstanceOf(IpnRejection);
    expect((error as IpnRejection).code).toBe(code);
    expect(String(error)).not.toContain(raw);
} });
test.each<Record<string, string>>([{ vnp_TransactionNo: 'notNumeric' }, { vnp_TransactionNo: '1234567890123456' }, { vnp_CurrCode: 'USD' }, { vnp_PayDate: '20260231090000' }, { vnp_ResponseCode: 'x' }])('semantic reject without financial authorization %j', override => {
    const raw = signed({ ...p, ...override });
    authenticateIpn(raw, config);
    expect(() => verifyIpn(raw, config, p.vnp_TxnRef, '85000')).toThrow(IpnRejection);
});
test('feature gate OFF requires no merchant credentials and does not access database', async () => {
    const tx = jest.fn();
    const service = new IpnService({ $transaction: tx } as unknown as PrismaService, new ConfigService({ PAYMENT_PROVIDER_MODE: 'MOCK' }));
    expect(await service.receive(signed(p))).toEqual(ipnAck('99'));
    expect(tx).not.toHaveBeenCalled();
});
test('invalid callback diagnostics are bounded and never contain raw query or credentials', async () => {
    const warn=jest.spyOn(Logger.prototype,'warn').mockImplementation(()=>{}),transaction=jest.fn();
    try {
        const service=new IpnService({$transaction:transaction} as unknown as PrismaService,new ConfigService({PAYMENT_PROVIDER_MODE:'VNPAY_SANDBOX',VNPAY_INITIATION_CONFIG:config}));
        for(let i=0;i<20;i++) expect(await service.receive('vnp_Unsupported=synthetic-sensitive-'+i)).toEqual(ipnAck('99'));
        expect(warn).toHaveBeenCalledTimes(1);expect(warn).toHaveBeenCalledWith('VNPAY_IPN_REJECTED');expect(transaction).not.toHaveBeenCalled();
    } finally {warn.mockRestore();}
});
describe('public provider ACK HTTP boundary', () => {
    let app: NestExpressApplication;
    const receive = jest.fn();
    beforeAll(async () => { const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({}).overrideProvider(IpnService).useValue({ receive }).compile(); app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); });
    beforeEach(() => { receive.mockReset(); });
    afterAll(async () => app.close());
    test.each(['00', '01', '02', '04', '97', '99'])('ACK%s has HTTP200, no JWT, no generic envelope', async (code) => {
        receive.mockResolvedValue(ipnAck(code));
        const raw = signed(p);
        const r = await request(app.getHttpServer()).get('/payments/vnpay/ipn?' + raw).expect(200);
        expect(r.body).toEqual(ipnAck(code));
        expect(r.headers['cache-control']).toBe('no-store');
        expect(receive).toHaveBeenCalledWith(raw);
    });
    test.each(['{"override":"PAID"}', '{malformed', 'x'.repeat(66000)])('framed body rejected before JSON parser (%#)', async (body) => {
        const r = await request(app.getHttpServer()).get('/payments/vnpay/ipn?' + signed(p)).set('Content-Type', 'application/json').send(body).expect(200);
        expect(r.body).toEqual(ipnAck('99'));
        expect(receive).not.toHaveBeenCalled();
    });
    test.each(['/payments/vnpay/ipn/', '/PAYMENTS/VNPAY/IPN'])('equivalent route %s cannot bypass body rejection', async (path) => {
        const r = await request(app.getHttpServer()).get(path + '?' + signed(p)).set('Content-Type', 'application/json').send('{broken').expect(200);
        expect(r.body).toEqual(ipnAck('99'));
        expect(receive).not.toHaveBeenCalled();
    });
});

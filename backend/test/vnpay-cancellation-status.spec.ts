import { ConfigService } from '@nestjs/config';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import { AttemptService } from '../src/payments/attempt.service';

describe('read-only verified cancellation projection', () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    const orderId = '22222222-2222-4222-8222-222222222222';
    const id = '33333333-3333-4333-8333-333333333333';
    const now = new Date();
    function fixture() {
        const receipt = { state: 'VERIFIED', processedAt: now as Date | null, payload: { responseCode: '24', transactionStatus: '02' } };
        const payment = { id: owner, userId: owner, orderId, provider: 'VNPAY_SANDBOX', amount: new Prisma.Decimal(30000), status: 'FAILED', gatewayAttemptId: id, idempotencyRequestId: owner, confirmedAt: now };
        const a = { id, orderId, idempotencyRequestId: owner, provider: 'VNPAY_SANDBOX', amount: new Prisma.Decimal(30000), currency: 'VND', state: 'FAILED', applicationState: 'APPLIED',
            responseCode: '24', transactionStatus: '02', createdAt: now, expiresAt: new Date(Date.now() + 60000), verifiedAt: now as Date | null, appliedAt: now as Date | null, payment, verifications: [receipt] };
        const o = { id: orderId, userId: owner, total: new Prisma.Decimal(30000), status: 'CANCELLED', paidAt: null, payments: [payment], items: [], redeemedPoints: 0 };
        const execute = jest.fn().mockResolvedValue(0);
        const tx = { $executeRawUnsafe: execute,
            order: { findFirst: jest.fn().mockResolvedValue(o) },
            paymentAttempt: { findFirst: jest.fn((args: { where: { id?: string; applicationState?: string; OR?: unknown } }) => Promise.resolve(args.where.id || (!args.where.applicationState && !args.where.OR) ? a : null)) },
            paymentVerification: { findFirst: jest.fn().mockResolvedValue(null) } };
        const transaction = jest.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx));
        const service = new AttemptService({ $transaction: transaction } as unknown as PrismaService, new ConfigService({ PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_CONFIG: {}, VNPAY_ACCEPT_NEW_PAYMENTS: false }));
        return { a, o, receipt, execute, service, tx };
    }
    it('maps processed verified24/02 only after bound failure application; capabilities unchanged', async () => {
        const f = fixture();
        const result = await f.service.get(owner, id);
        expect(result).toMatchObject({ failureReason: 'CUSTOMER_CANCELLED', effectiveState: 'FAILED', orderStatus: 'CANCELLED', canRetry: false, canResume: false, canCancel: false });
        expect(f.execute).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    });
    it.each(['AWAITING', 'UNKNOWN', 'SUCCEEDED'])('does not label %s as customer cancellation', async state => {
        const f = fixture(); f.a.state = state;
        expect(await f.service.get(owner, id)).not.toHaveProperty('failureReason');
    });
    it.each(['PENDING', 'REVIEW'])('does not label application %s as cancellation', async state => {
        const f = fixture(); f.a.applicationState = state;
        expect(await f.service.get(owner, id)).not.toHaveProperty('failureReason');
    });
    it('does not label a generic failure or an unprocessed/unverified/contradictory receipt', async () => {
        for (const variant of ['generic', 'unprocessed', 'unverified', 'mismatch', 'unapplied']) {
            const f = fixture();
            if (variant === 'generic') f.a.responseCode = '51';
            if (variant === 'unprocessed') f.receipt.processedAt = null;
            if (variant === 'unverified') f.receipt.state = 'UNRESOLVED';
            if (variant === 'mismatch') f.receipt.payload.responseCode = '51';
            if (variant === 'unapplied') f.a.appliedAt = null;
            expect(await f.service.get(owner, id)).not.toHaveProperty('failureReason');
        }
    });
    it('gateway cancellation does not imply that the Order itself was cancelled', async () => {
        const f = fixture(); f.o.status = 'PAYMENT_FAILED';
        expect(await f.service.get(owner, id)).toMatchObject({ failureReason: 'CUSTOMER_CANCELLED', orderStatus: 'PAYMENT_FAILED', canRetry: false, canCancel: true });
    });
    it('does not navigate from a historical cancellation while an Order is pending again', async () => {
        const f = fixture(); f.o.status = 'PENDING';
        expect(await f.service.get(owner, id)).not.toHaveProperty('failureReason');
    });
    it('does not label cancellation while another verified receipt awaits processing', async () => {
        const f = fixture(); f.tx.paymentVerification.findFirst.mockResolvedValue({ id: owner });
        expect(await f.service.get(owner, id)).not.toHaveProperty('failureReason');
    });
});

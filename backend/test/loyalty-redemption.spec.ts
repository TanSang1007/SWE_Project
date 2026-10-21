import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../src/generated/prisma/client';
import { effect, persistEffects, validateRedemption } from '../src/loyalty/loyalty-accounting';
import { decodeCursor, encodeCursor } from '../src/loyalty/loyalty-cursor';
import { CreateOrderDto } from '../src/orders/order.dto';
import { LoyaltyHistoryQueryDto } from '../src/loyalty/loyalty.dto';
import { utcConnectionString } from '../src/database/pg-connection';
test.each([1, 10, 50, 100, 500])('P05 exact conversion %i points at100 VND', points => { const a = { userId: randomUUID(), available: 1000n, debt: 0n, reserved: 0n }; const q = validateRedemption(a, points, new Prisma.Decimal(100000)); expect(q.discount.toFixed(0)).toBe(String(points * 100)); expect(q.total.toFixed(0)).toBe(String(100000 - points * 100)); });
test('L15 atomic refund/reverse permits intermediate available overflow if final bound is valid', async () => {
    const before = { userId: randomUUID(), available: 2147483647n, debt: 0n, reserved: 0n };
    const after = { ...before };
    const source = { orderId: randomUUID() };
    const rows = [effect(after, 'REFUND', 50, source), effect(after, 'REVERSE', 50, source)];
    expect(after.available).toBe(before.available);
    const user = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    const loyaltyEntry = { create: jest.fn().mockResolvedValue({}) };
    await persistEffects({ user, loyaltyEntry } as unknown as Prisma.TransactionClient, before, after, rows);
    expect(user.updateMany).toHaveBeenCalledTimes(1);
    expect(loyaltyEntry.create).toHaveBeenCalledTimes(2);
});
test('L15 debt overflow rejects before any counter/journal write', async () => { const before = { userId: randomUUID(), available: 0n, debt: 9223372036854775807n, reserved: 0n }; const after = { ...before }; const row = effect(after, 'REVERSE', 1, { orderId: randomUUID() }); const user = { updateMany: jest.fn() }; await expect(persistEffects({ user } as unknown as Prisma.TransactionClient, before, after, [row])).rejects.toBeInstanceOf(ServiceUnavailableException); expect(user.updateMany).not.toHaveBeenCalled(); });
test('credit offsets debt first and any positive reservation is blocked, cash0 is allowed', () => { const a = { userId: randomUUID(), available: 0n, debt: 10n, reserved: 0n }; expect(() => validateRedemption(a, 1, new Prisma.Decimal(10000))).toThrow(ConflictException); expect(validateRedemption(a, 0, new Prisma.Decimal(10000)).total.toFixed(0)).toBe('10000'); const e = effect(a, 'EARN', 20, { orderId: randomUUID(), paymentId: randomUUID() }); expect(e).toMatchObject({ availableDelta: 10, debtDelta: -10n }); expect(a).toMatchObject({ available: 10n, debt: 0n }); });
test.each([-1, null, '10', 1.5, 2147483648])('strict Order DTO rejects redeemedPoints=%p', async (points) => { const dto = plainToInstance(CreateOrderDto, { items: [{ productId: randomUUID(), size: 'S', qty: 1, toppingIds: [] }], redeemedPoints: points }); expect((await validate(dto)).length).toBeGreaterThan(0); });
test.each(['0', '51', '01', '+1', '1.0', ['1', '2']])('strict history limit rejects %p', async (limit) => { expect((await validate(plainToInstance(LoyaltyHistoryQueryDto, { limit }))).length).toBeGreaterThan(0); });
test('S09 opaque cursor roundtrips exact BIGINT, bound to owner/secret and authenticated', () => {
    const secret = 'a'.repeat(32), owner = randomUUID();
    const cursor = encodeCursor(secret, owner, 9223372036854775807n, 9007199254740993n);
    expect(decodeCursor(secret, owner, cursor)).toEqual({ upper: 9223372036854775807n, last: 9007199254740993n });
    expect(cursor).not.toContain(owner);
    for (const [s, u, c] of [[secret, randomUUID(), cursor], ['b'.repeat(32), owner, cursor], [secret, owner, cursor.slice(0, -2) + 'XX'], [secret, owner, cursor + '=']])
        expect(() => decodeCursor(s, u, c)).toThrow(BadRequestException);
});
test('UTC connection option preserves schema scoping and credentials without mutating environment', () => { const url = new URL(utcConnectionString('postgresql://fixture:example@localhost/test_dev?options=-c%20search_path%3Downed')); expect(url.searchParams.get('options')).toBe('-c search_path=owned -c TimeZone=UTC'); expect(url.username).toBe('fixture'); });

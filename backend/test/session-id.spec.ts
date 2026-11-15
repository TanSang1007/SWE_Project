import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { isStoredId } from '../src/common/record-id';
import { validateSync } from 'class-validator';
import { OrderParamsDto, OrderReadParamsDto } from '../src/orders/order.dto';
import { sessionCookie } from '../src/auth/session.service';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import type { ConfigService } from '@nestjs/config';
import type { UsersService } from '../src/users/users.service';
import type { PrismaService } from '../src/database/prisma.service';

describe('session identity compatibility', () => {
  const token = randomBytes(32).toString('base64url');
  const request = (id: string, value = token) => ({ headers: { cookie: `brewlite_session=${id}.${value}` } }) as Request;
  it('accepts existing numeric identities and new UUID identities without exposing the token', () => {
    for (const id of ['1', '1234567890', randomUUID()]) {
      expect(isStoredId(id)).toBe(true);
      const parsed = sessionCookie(request(id));
      expect(parsed.id).toBe(id);
      expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it('rejects malformed identities before they reach SQL', () => {
    for (const id of ['', '0', '-1', '1e2', '1.2', '1 OR 1=1', '9'.repeat(21), '-'.repeat(36), 'a'.repeat(36)]) {
      expect(isStoredId(id)).toBe(false);
      expect(() => sessionCookie(request(id))).toThrow(UnauthorizedException);
    }
  });
  it('rejects missing, truncated and extra cookie components', () => {
    expect(() => sessionCookie({ headers: {} } as Request)).toThrow(UnauthorizedException);
    for (const value of ['', token.slice(1), token + '.extra']) expect(() => sessionCookie(request(randomUUID(), value))).toThrow(UnauthorizedException);
  });
  it('restores existing numeric users with their current database role', async () => {
    const user = { id: '7', role: 'CUSTOMER' };
    const users = { findPublic: jest.fn().mockResolvedValue(user) };
    const db = { authSession: { findFirst: jest.fn().mockResolvedValue({ id: '12' }) } };
    const config = { getOrThrow: jest.fn().mockReturnValue('isolated-test-secret-with-at-least-32-bytes') };
    const strategy = new JwtStrategy(config as unknown as ConfigService, users as unknown as UsersService, db as unknown as PrismaService);
    expect(await strategy.validate({ sub: '7', sid: '12', exp: Math.floor(Date.now() / 1000) + 3600, role: 'ADMIN' })).toEqual(user);
    expect(users.findPublic).toHaveBeenCalledWith('7');
    db.authSession.findFirst.mockResolvedValue(null);
    await expect(strategy.validate({ sub: '7', sid: '12', exp: Math.floor(Date.now() / 1000) + 3600 })).rejects.toThrow(UnauthorizedException);
  });
  it('accepts legacy order IDs only in read parameters; mutation IDs remain UUIDs', () => {
    expect(validateSync(Object.assign(new OrderReadParamsDto(), { id: '1' }))).toHaveLength(0);
    expect(validateSync(Object.assign(new OrderReadParamsDto(), { id: '1 OR 1=1' }))).not.toHaveLength(0);
    expect(validateSync(Object.assign(new OrderParamsDto(), { id: '1' }))).not.toHaveLength(0);
  });
});

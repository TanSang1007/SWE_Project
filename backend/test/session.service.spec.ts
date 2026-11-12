import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { SessionService } from '../src/auth/session.service';
import type { PrismaService } from '../src/database/prisma.service';
import type { UsersService } from '../src/users/users.service';

type TestSession = {
  id: string;
  userId: string;
  tokenHash: string;
  previousTokenHash: string | null;
  revokedAt: Date | null;
  expiresAt: Date;
};
type UpdateArgs = { where: Record<string, unknown>; data: Record<string, unknown> };
type PublicUser = { id: string; email: string; loyaltyPoints: number; role: 'CUSTOMER' };

const id = randomUUID();
const userId = randomUUID();
const rawToken = 'a'.repeat(43);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const expiresAt = new Date(Date.now() + 60_000);

function request(): Request {
  return {
    headers: {
      cookie: `brewlite_session=${id}.${rawToken}`,
      origin: 'http://localhost:3000',
      'x-brewlite-csrf': '1',
    },
  } as unknown as Request;
}

function response() {
  const setCookie = jest.fn<void, unknown[]>();
  const setHeader = jest.fn<void, unknown[]>();
  return { response: { cookie: setCookie, setHeader } as unknown as Response, setCookie };
}

function fixture(overrides: Partial<TestSession> = {}) {
  const session: TestSession = {
    id, userId, tokenHash: digest(rawToken), previousTokenHash: null, revokedAt: null, expiresAt, ...overrides,
  };
  const findUnique = jest.fn<Promise<TestSession>, unknown[]>().mockResolvedValue(session);
  const updateMany = jest.fn<Promise<{ count: number }>, [UpdateArgs]>();
  const findPublic = jest.fn<Promise<PublicUser>, unknown[]>().mockResolvedValue({
    id: session.userId, email: 'customer@example.invalid', loyaltyPoints: 0, role: 'CUSTOMER',
  });
  const signAsync = jest.fn<Promise<string>, unknown[]>().mockResolvedValue('access-token');
  const db = { authSession: { findUnique, updateMany } };
  const users = { findPublic };
  const jwt = { signAsync };
  const config = {
    getOrThrow: (key: string): string | number => key === 'FRONTEND_ORIGIN' ? 'http://localhost:3000' : 3600,
    get: (): string => 'development',
  };
  const service = new SessionService(
    db as unknown as PrismaService,
    users as unknown as UsersService,
    jwt as unknown as JwtService,
    config as unknown as ConfigService,
  );
  return { updateMany, service };
}

describe('SessionService.restore', () => {
  test('rotates a valid session with an atomic compare-and-swap update', async () => {
    const { updateMany, service } = fixture();
    updateMany.mockResolvedValueOnce({ count: 1 });
    const res = response();

    await expect(service.restore(request(), res.response)).resolves.toMatchObject({ accessToken: 'access-token' });

    expect(updateMany).toHaveBeenCalledTimes(1);
    const [rotation] = updateMany.mock.calls[0];
    expect(rotation.where).toMatchObject({ id, tokenHash: digest(rawToken), revokedAt: null });
    expect(rotation.data).toMatchObject({ previousTokenHash: digest(rawToken) });
    expect(res.setCookie).toHaveBeenCalledTimes(1);
  });

  test('revokes a session when the immediately previous cookie is replayed', async () => {
    const { updateMany, service } = fixture({ tokenHash: digest('b'.repeat(43)), previousTokenHash: digest(rawToken) });
    updateMany.mockResolvedValue({ count: 1 });

    await expect(service.restore(request(), response().response)).rejects.toBeInstanceOf(UnauthorizedException);

    const [replay] = updateMany.mock.calls[0];
    expect(replay.where).toMatchObject({ id, previousTokenHash: digest(rawToken), revokedAt: null });
    expect(replay.data.revokedAt).toBeInstanceOf(Date);
  });

  test('revokes the session when another request wins the rotation race', async () => {
    const { updateMany, service } = fixture();
    updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

    await expect(service.restore(request(), response().response)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(updateMany).toHaveBeenCalledTimes(2);
    const [raceRecovery] = updateMany.mock.calls[1];
    expect(raceRecovery.where).toMatchObject({ id, previousTokenHash: digest(rawToken), revokedAt: null });
    expect(raceRecovery.data.revokedAt).toBeInstanceOf(Date);
  });

  test('rejects an expired session without attempting a mutation', async () => {
    const { updateMany, service } = fixture({ expiresAt: new Date(0) });

    await expect(service.restore(request(), response().response)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(updateMany).not.toHaveBeenCalled();
  });
});

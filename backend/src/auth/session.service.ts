import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from '../users/users.service';

const cookieName = 'brewlite_session';
const duration = 7 * 24 * 60 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function rawCookieToken(req: Request): string | undefined {
  return req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
}

export function sessionCookie(req: Request) {
  const headerVal = req.headers['x-brewlite-session'];
  const fromHeader = typeof headerVal === 'string' && headerVal.trim() ? headerVal.trim() : undefined;
  const value = fromHeader ?? rawCookieToken(req);
  if (!value || !/^[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{43}$/.test(value)) throw new UnauthorizedException();
  const [id, token] = value.split('.');
  return { id, hash: digest(token), fromHeader: Boolean(fromHeader) };
}

@Injectable()
export class SessionService {
  constructor(
    private readonly db: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  assertOrigin(req: Request) {
    const expected = this.config.getOrThrow<string>('FRONTEND_ORIGIN');
    if (req.headers.origin !== expected || req.headers['x-brewlite-csrf'] !== '1') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Invalid session request origin' });
    }
  }

  private cookie(res: Response, id: string, token: string, expires: Date) {
    res.cookie(cookieName, id + '.' + token, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      expires,
    });
    res.setHeader('Cache-Control', 'private, no-store');
  }

  private async response(
    userOrId: string | { id: string; email: string; loyaltyPoints: number; role: 'CUSTOMER' | 'STAFF' | 'ADMIN' },
    sid: string,
    sessionToken: string,
  ) {
    const user = typeof userOrId === 'string' ? await this.users.findPublic(userOrId) : userOrId;
    if (!user) throw new UnauthorizedException();
    return {
      user,
      tokenType: 'Bearer' as const,
      expiresIn: this.config.getOrThrow<number>('JWT_EXPIRES_IN'),
      accessToken: await this.jwt.signAsync({ sub: user.id, sid }),
      sessionToken,
    };
  }

  async create(
    userOrId: string | { id: string; email: string; loyaltyPoints: number; role: 'CUSTOMER' | 'STAFF' | 'ADMIN' },
    res: Response,
  ) {
    const userId = typeof userOrId === 'string' ? userOrId : userOrId.id;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + duration);
    const created = await this.db.authSession.create({
      data: { userId, tokenHash: digest(token), expiresAt },
      select: { id: true },
    });
    const sessionToken = `${created.id}.${token}`;
    const result = await this.response(userOrId, created.id, sessionToken);
    this.cookie(res, created.id, token, expiresAt);
    return result;
  }

  async restore(req: Request, res: Response) {
    this.assertOrigin(req);
    const input = sessionCookie(req);
    const isTabInit = !input.fromHeader && req.headers['x-brewlite-tab-init'] === '1';
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const session = await this.db.authSession.findUnique({ where: { id: input.id } });

    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedException();
    }

    if (!equal(session.tokenHash, input.hash)) {
      if (session.previousTokenHash && equal(session.previousTokenHash, input.hash)) {
        await this.db.authSession.updateMany({
          where: {
            id: session.id,
            previousTokenHash: input.hash,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { revokedAt: now },
        });
      }
      throw new UnauthorizedException();
    }

    if (isTabInit) {
      const created = await this.db.authSession.create({
        data: { userId: session.userId, tokenHash: digest(token), expiresAt: session.expiresAt },
      });
      const body = await this.response(created.userId, created.id, `${created.id}.${token}`);
      res.setHeader('Cache-Control', 'private, no-store');
      return body;
    }

    const rotated = await this.db.authSession.updateMany({
      where: {
        id: session.id,
        tokenHash: input.hash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        previousTokenHash: input.hash,
        tokenHash: digest(token),
      },
    });

    if (rotated.count !== 1) {
      await this.db.authSession.updateMany({
        where: {
          id: session.id,
          previousTokenHash: input.hash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
      throw new UnauthorizedException();
    }

    const sessionToken = `${session.id}.${token}`;
    const body = await this.response(session.userId, session.id, sessionToken);
    if (!input.fromHeader && !isTabInit) {
      this.cookie(res, session.id, token, session.expiresAt);
    } else {
      res.setHeader('Cache-Control', 'private, no-store');
    }
    return body;
  }

  async logout(req: Request, res: Response) {
    this.assertOrigin(req);
    let shouldClearCookie = true;
    try {
      const input = sessionCookie(req);
      await this.db.authSession.updateMany({
        where: { id: input.id, OR: [{ tokenHash: input.hash }, { previousTokenHash: input.hash }] },
        data: { revokedAt: new Date() },
      });
      if (input.fromHeader) {
        const cookieVal = rawCookieToken(req);
        shouldClearCookie = Boolean(cookieVal && cookieVal.startsWith(input.id + '.'));
      }
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
    }
    if (shouldClearCookie) {
      res.clearCookie(cookieName, {
        httpOnly: true,
        secure: this.config.get('NODE_ENV') === 'production',
        sameSite: 'lax',
        path: '/api/auth',
      });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return { loggedOut: true };
  }
}

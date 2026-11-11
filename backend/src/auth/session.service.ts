import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";
import { PrismaService } from "../database/prisma.service";
import { UsersService } from "../users/users.service";

const cookieName = "brewlite_session";
const duration = 7 * 24 * 60 * 60 * 1000;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function sessionCookie(req: Request) {
  const value = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  if (!value || !/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(value))
    throw new UnauthorizedException();
  const [id, token] = value.split(".");
  return { id, hash: digest(token) };
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
    if (
      req.headers.origin !==
        this.config.getOrThrow<string>("FRONTEND_ORIGIN") ||
      req.headers["x-brewlite-csrf"] !== "1"
    ) {
      throw new ForbiddenException({
        code: "FORBIDDEN",
        message: "Invalid session request origin",
      });
    }
  }
  private cookie(res: Response, id: string, token: string, expires: Date) {
    res.cookie(cookieName, id + "." + token, {
      httpOnly: true,
      secure: this.config.get("NODE_ENV") === "production",
      sameSite: "lax",
      path: "/api/auth",
      expires,
    });
    res.setHeader("Cache-Control", "private, no-store");
  }
  private async response(userId: string, sid: string) {
    const user = await this.users.findPublic(userId);
    if (!user) throw new UnauthorizedException();
    return {
      user,
      tokenType: "Bearer" as const,
      expiresIn: this.config.getOrThrow<number>("JWT_EXPIRES_IN"),
      accessToken: await this.jwt.signAsync({ sub: userId, sid }),
    };
  }
  async create(userId: string, res: Response) {
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      expiresAt = new Date(Date.now() + duration);
    await this.db.authSession.create({
      data: { id, userId, tokenHash: digest(token), expiresAt },
    });
    const result = await this.response(userId, id);
    this.cookie(res, id, token, expiresAt);
    return result;
  }

  async restore(req: Request, res: Response) {
    this.assertOrigin(req);

    const input = sessionCookie(req);
    const token = randomBytes(32).toString("base64url");
    const now = new Date();

    const session = await this.db.authSession.findUnique({
      where: { id: input.id },
    });

    if (!session || session.revokedAt || session.expiresAt <= now) {
      throw new UnauthorizedException();
    }

    if (!equal(session.tokenHash, input.hash)) {
      if (
        session.previousTokenHash &&
        equal(session.previousTokenHash, input.hash)
      ) {
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

    const body = await this.response(session.userId, session.id);
    this.cookie(res, session.id, token, session.expiresAt);
    return body;
  }

  async logout(req: Request, res: Response) {
    this.assertOrigin(req);
    try {
      const input = sessionCookie(req);
      await this.db.authSession.updateMany({
        where: {
          id: input.id,
          OR: [{ tokenHash: input.hash }, { previousTokenHash: input.hash }],
        },
        data: { revokedAt: new Date() },
      });
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
    }
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: this.config.get("NODE_ENV") === "production",
      sameSite: "lax",
      path: "/api/auth",
    });
    res.setHeader("Cache-Control", "private, no-store");
    return { loggedOut: true };
  }
}

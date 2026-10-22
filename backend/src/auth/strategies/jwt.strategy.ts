import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { isUUID } from 'class-validator';
import { UsersService } from '../../users/users.service';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService, private readonly users: UsersService, private readonly db: PrismaService) {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'), algorithms: ['HS256'] });
  }
  async validate(payload: unknown) {
    if (typeof payload !== 'object' || payload === null || !('sub' in payload) || typeof payload.sub !== 'string'
      || !isUUID(payload.sub) || !('exp' in payload) || typeof payload.exp !== 'number' || !Number.isInteger(payload.exp)) {
      throw new UnauthorizedException();
    }
    if ('sid' in payload) {
      if (typeof payload.sid !== 'string' || !isUUID(payload.sid)) throw new UnauthorizedException();
      const session = await this.db.authSession.findFirst({ where: { id: payload.sid, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (!session) throw new UnauthorizedException();
    }
    const user = await this.users.findPublic(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}

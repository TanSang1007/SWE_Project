import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcrypt';
import { Prisma } from '../generated/prisma/client';
import { UsersService } from '../users/users.service';
import { CredentialsDto } from './dto/credentials.dto';

@Injectable()
export class AuthService {
  // Unknown-email attempts still perform bcrypt work; this is not a credential.
  private readonly dummyHash = hash(randomBytes(32).toString('hex'), 10);
  constructor(private readonly users: UsersService, private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async register(credentials: CredentialsDto) {
    const passwordHash = await hash(credentials.password, 10);
    try { return { user: await this.users.create(credentials.email, passwordHash) }; }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'EMAIL_ALREADY_EXISTS', message: 'Email already registered' });
      }
      throw error;
    }
  }
  async login(credentials: CredentialsDto) {
    const user = await this.users.findCredentials(credentials.email);
    const valid = await compare(credentials.password, user?.passwordHash ?? await this.dummyHash);
    if (!user || !valid) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    const { id, email, loyaltyPoints, role } = user;
    return {
      accessToken: await this.jwt.signAsync({ sub: id }), tokenType: 'Bearer' as const,
      expiresIn: this.config.getOrThrow<number>('JWT_EXPIRES_IN'), user: { id, email, loyaltyPoints, role },
    };
  }
}

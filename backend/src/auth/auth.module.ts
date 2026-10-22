import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { DatabaseModule } from '../database/database.module';
import { SessionService } from './session.service';
@Module({
  imports: [DatabaseModule, UsersModule, PassportModule, JwtModule.registerAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => ({
    secret: config.getOrThrow<string>('JWT_SECRET'), signOptions: { algorithm: 'HS256', expiresIn: config.getOrThrow<number>('JWT_EXPIRES_IN') },
  }) })],
  controllers: [AuthController], providers: [AuthService, SessionService, JwtStrategy, JwtAuthGuard, RolesGuard], exports: [JwtAuthGuard, RolesGuard],
})
export class AuthModule {}

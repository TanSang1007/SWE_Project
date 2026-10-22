import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionService } from './session.service';
import { AuthService } from './auth.service';
import { CredentialsDto } from './dto/credentials.dto';
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly sessions: SessionService) {}
  @Post('register')
  register(@Body() credentials: CredentialsDto) { return this.auth.register(credentials); }
  @Post('login')
  @HttpCode(200)
  async login(@Body() credentials: CredentialsDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.sessions.assertOrigin(req);
    const result = await this.auth.login(credentials);
    return this.sessions.create(result.user.id, res);
  }
  @Post('session')
  @HttpCode(200)
  restore(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.sessions.restore(req, res); }
  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.sessions.logout(req, res); }
}

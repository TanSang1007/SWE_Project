import { Body, Controller, Get, Header, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SessionService } from './session.service';
import { AuthService } from './auth.service';
import { CredentialsDto } from './dto/credentials.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
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
    return this.sessions.create(result.user, res);
  }
  @Post('session')
  @HttpCode(200)
  restore(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.sessions.restore(req, res); }
  // Lightweight check that the tab's access token still belongs to a live session.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store, max-age=0')
  me(@Req() req: Request) { return { user: req.user }; }
  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.sessions.logout(req, res); }
}

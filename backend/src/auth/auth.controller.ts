import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CredentialsDto } from './dto/credentials.dto';
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register')
  register(@Body() credentials: CredentialsDto) { return this.auth.register(credentials); }
  @Post('login')
  @HttpCode(200)
  login(@Body() credentials: CredentialsDto) { return this.auth.login(credentials); }
}

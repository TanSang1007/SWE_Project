import { Controller, Get, Header, Param, Res, UseGuards } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';

export class UserParamsDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  id!: string;
}

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  list() {
    return this.users.findAll();
  }

  @Get('users/:id')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  get(@Param() params: UserParamsDto) {
    return this.users.findById(params.id);
  }

  @Get('admin/users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  adminList(@Res({ passthrough: true }) res: Response) {
    res.vary('Authorization');
    return this.users.findAll();
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const publicSelect = { id: true, email: true, loyaltyPoints: true, role: true } as const;
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}
  findCredentials(email: string) {
    return this.prisma.user.findUnique({ where: { email }, select: { ...publicSelect, passwordHash: true } });
  }
  findPublic(id: string) { return this.prisma.user.findUnique({ where: { id }, select: publicSelect }); }
  create(email: string, passwordHash: string) {
    return this.prisma.user.create({ data: { email, passwordHash, role: 'CUSTOMER' }, select: publicSelect });
  }
}

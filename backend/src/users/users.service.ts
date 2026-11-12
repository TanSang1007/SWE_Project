import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export const publicSelect = { id: true, email: true, loyaltyPoints: true, role: true } as const;
const detailSelect = { id: true, email: true, loyaltyPoints: true, role: true, createdAt: true, updatedAt: true } as const;

function compareIds(a: string, b: string) {
  const na = /^\d+$/.test(a) ? Number(a) : Number.POSITIVE_INFINITY;
  const nb = /^\d+$/.test(b) ? Number(b) : Number.POSITIVE_INFINITY;
  return na !== nb ? na - nb : a.localeCompare(b);
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}
  findCredentials(email: string) {
    return this.prisma.user.findUnique({ where: { email }, select: { ...publicSelect, passwordHash: true } });
  }
  findPublic(id: string) {
    return this.prisma.user.findUnique({ where: { id }, select: publicSelect });
  }
  async findAll() {
    const rows = await this.prisma.user.findMany({ select: detailSelect });
    rows.sort((a, b) => compareIds(a.id, b.id));
    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        loyaltyPoints: u.loyaltyPoints,
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
      })),
    };
  }
  async findById(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id: id.trim() }, select: detailSelect });
    if (!u) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      loyaltyPoints: u.loyaltyPoints,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    };
  }
  create(email: string, passwordHash: string) {
    return this.prisma.user.create({ data: { email, passwordHash, role: 'CUSTOMER' }, select: publicSelect });
  }
}

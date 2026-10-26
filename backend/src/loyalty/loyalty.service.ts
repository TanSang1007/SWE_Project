import { HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { decodeCursor, encodeCursor } from './loyalty-cursor';
import type { LoyaltyHistoryQueryDto } from './loyalty.dto';

@Injectable()
export class LoyaltyService {
  constructor(private readonly db: PrismaService, private readonly config: ConfigService) {}
  async balance(userId: string) {
    try {
      return await this.db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY') ;
        const user = await tx.user.findUnique({ where: { id: userId }, select: { loyaltyPoints: true, loyaltyDebt: true } });
        if (!user) throw new UnauthorizedException();
        const held = await tx.order.aggregate({ where: { userId, redemptionState: 'RESERVED' }, _sum: { redeemedPoints: true } });
        return { loyaltyPoints: user.loyaltyPoints, reservedPoints: held._sum.redeemedPoints ?? 0,
          outstandingReversalPoints: user.loyaltyDebt.toString(), pointValueVnd: '100' };
      }, { isolationLevel: 'RepeatableRead' });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException();
    }
  }
  async history(userId: string, query: LoyaltyHistoryQueryDto) {
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
    const position = query.cursor ? decodeCursor(secret,userId,query.cursor) : null;
    const limit = query.limit ? Number(query.limit) : 20;
    try {
      return await this.db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const upper = position?.upper ?? (await tx.loyaltyEntry.findFirst({ where: { userId }, orderBy: { sequence: 'desc' }, select: { sequence: true } }))?.sequence ?? 0n;
        const rows = await tx.loyaltyEntry.findMany({ where: { userId, sequence: { lte: upper, ...(position ? { lt: position.last } : {}) } },
          orderBy: { sequence: 'desc' }, take: limit+1, include: { order: { select: { userId: true, id: true, orderCode: true } } } });
        const page = rows.slice(0,limit);
        const items = page.map(e => {
          if (e.order && e.order.userId !== userId) throw new ServiceUnavailableException();
          return { kind: e.kind, orderId: e.order?.id ?? null, orderCode: e.order?.orderCode ?? null, points: e.points,
            availableChange: e.availableDelta, reservedChange: e.reservedDelta, outstandingReversalChange: e.debtDelta.toString(),
            debtOffsetPoints: (e.debtDelta < 0n ? -e.debtDelta : 0n).toString(), debtCreatedPoints: (e.debtDelta > 0n ? e.debtDelta : 0n).toString(),
            createdAt: e.createdAt.toISOString() };
        });
        return { scope: 'SINCE_L01_CUTOVER', items, nextCursor: rows.length > limit ? encodeCursor(secret,userId,upper,page[page.length-1].sequence ) : null };
      },  { isolationLevel: 'RepeatableRead' });
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException(); }
  }
}

import { ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { requireIdempotencyKey, replayResult } from '../common/idempotency';
import { lockUser } from '../orders/order-policy';
import type { InventoryAdjustmentDto } from './admin-inventory.dto';
const maxInt = 2147483647;
const unavailable = () => new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Inventory unavailable; retain the original request for recovery' });
const conflict = () => new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Stock or product changed; reload and confirm a new adjustment' });
function sqlCode(error: Prisma.PrismaClientKnownRequestError) {
  const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
  return typeof error.meta?.code === 'string' ? error.meta.code : adapter?.cause?.originalCode ?? '';
}
@Injectable()
export class AdminInventoryService {
  constructor(private readonly db: PrismaService) {}
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', '200ms', true), set_config('statement_timeout', '300ms', true)`;
      return work(tx);
    }, { maxWait: 50, timeout: 400 });
  }
  async list() {
    try {
      const items = await this.db.product.findMany({ orderBy: { id: 'asc' }, select: { id: true, name: true, stock: true, version: true } });
      return { items: items.map(p => ({ productId: p.id, productName: p.name, stock: p.stock, version: p.version })) };
    } catch { throw unavailable(); }
  }
  // A separate read also provides a deterministic integration-test barrier.
  private readProduct(tx: Prisma.TransactionClient, id: string) {
    return tx.product.findUnique({ where: { id }, select: { id: true, stock: true, version: true } });
  }
  async adjust(userId: string, productId: string, key: string | undefined, input: InventoryAdjustmentDto) {
    requireIdempotencyKey(key);
    const hash = createHash('sha256').update(JSON.stringify({ operation: 'ADJUST_INVENTORY', productId, delta: input.delta, expectedVersion: input.expectedVersion })).digest('hex');
    const where = { userId_operation_idempotencyKey: { userId, operation: 'ADJUST_INVENTORY' as const, idempotencyKey: key } };
    const replay = (claim: Prisma.IdempotencyRequestGetPayload<object>) => ({ ...replayResult(claim, hash), status: claim.responseStatus ?? 200 });
    try {
      return await this.transaction(async tx => {
        const prior = await tx.idempotencyRequest.findUnique({ where }); if (prior) return replay(prior);
        // Lock actor before the claim's User FK; never acquire a customer lock.
        await lockUser(tx, userId);
        const completed = await tx.idempotencyRequest.findUnique({ where }); if (completed) return replay(completed);
        const claim = await tx.idempotencyRequest.create({ data: { userId, operation: 'ADJUST_INVENTORY', idempotencyKey: key, requestHash: hash, state: 'PROCESSING' } });
        const product = await this.readProduct(tx, productId);
        if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
        if (product.version !== input.expectedVersion) throw conflict();
        const stock = product.stock + input.delta;
        if (!Number.isSafeInteger(stock) || stock < 0 || stock > maxInt) throw new ConflictException({ code: 'INVALID_STOCK_ADJUSTMENT', message: 'Result stock must be within integer bounds' });
        if (product.version >= maxInt) throw unavailable();
        const changed = await tx.product.updateMany({ where: { id: productId, version: input.expectedVersion }, data: { stock: { increment: input.delta }, version: { increment: 1 }, updatedAt: new Date() } });
        if (changed.count !== 1) throw conflict();
        const body = { productId, delta: input.delta, previousStock: product.stock, stock, version: product.version + 1 };
        await tx.idempotencyRequest.update({ where: { id: claim.id }, data: { state: 'COMPLETED', orderId: null, responseStatus: 200, responseBody: body, completedAt: new Date() } });
        return { body, replayed: false, status: 200 };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Rollback completed before the one recovery read. Never retry a mutation.
      try { const prior = await this.transaction(tx => tx.idempotencyRequest.findUnique({ where })); if (prior) return replay(prior); }
      catch (recovery) { if (recovery instanceof HttpException) throw recovery; }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Retry the same key and request later' });
        if (['P2028', 'P2034'].includes(error.code) || ['55P03', '57014', '40P01', '40001'].includes(sqlCode(error))) {
          // A duplicate may still be committing. Preserve key/body on unknown
          // contention rather than presenting it as a confirmed new action.
          throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Retry the same key and request later' });
        }
      }
      throw unavailable();
    }
  }
}

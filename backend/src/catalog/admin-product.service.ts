import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { ProductCreateDto, ProductUpdateDto } from './admin-product.dto';

const select = { id: true, name: true, price: true, imageUrl: true, stock: true, isActive: true, version: true, createdAt: true, updatedAt: true,
  sizes: { select: { size: true, extraPrice: true, isActive: true } },
  toppings: { orderBy: { toppingId: 'asc' as const }, select: { topping: { select: { id: true, name: true, price: true, createdAt: true, updatedAt: true } } } },
} satisfies Prisma.ProductSelect;
type Row = Prisma.ProductGetPayload<{ select: typeof select }>;
const conflict = () => new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Product changed; reload and confirm again' });
const inUse = () => new ConflictException({ code: 'RESOURCE_IN_USE', message: 'Product is referenced or lacks required configuration; stop selling instead of deleting' });
const missing = () => new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' });
const unavailable = () => new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Product management unavailable' });
function response(row: Row) {
  return { id: row.id, name: row.name, price: row.price.toFixed(0), imageUrl: row.imageUrl, stock: row.stock, isActive: row.isActive, version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    sizes: row.sizes.sort((a, b) => ['S', 'M', 'L'].indexOf(a.size) - ['S', 'M', 'L'].indexOf(b.size)).map(s => ({ size: s.size, extraPrice: s.extraPrice.toFixed(0) })),
    toppings: row.toppings.map(({ topping: t }) => ({ id: t.id, name: t.name, price: t.price.toFixed(0), createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() })) };
}
@Injectable()
export class AdminProductService {
  constructor(private readonly db: PrismaService) {}
  private async safely<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
        const sql = typeof error.meta?.code === 'string' ? error.meta.code : adapter?.cause?.originalCode ?? '';
        if (error.code === 'P2003' || sql === '23503') throw inUse();
        if (['P2028', 'P2034'].includes(error.code) || ['55P03', '57014', '40P01', '40001'].includes(sql)) throw conflict();
      }
      throw unavailable();
    }
  }
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', '200ms', true), set_config('statement_timeout', '300ms', true)`;
      return work(tx);
    }, { maxWait: 50, timeout: 400 });
  }
  list() { return this.safely(async () => ({ items: (await this.db.product.findMany({ select, orderBy: { id: 'asc' } })).map(response) })); }
  get(id: string) { return this.safely(async () => { const row = await this.db.product.findUnique({ where: { id }, select }); if (!row) throw missing(); return response(row); }); }
  create(input: ProductCreateDto) {
    return this.safely(() => this.transaction(async tx => {
      const ids = input.toppingIds;
      if (await tx.topping.count({ where: { id: { in: ids } } }) !== ids.length) throw new NotFoundException({ code: 'TOPPING_NOT_FOUND', message: 'Topping not found' });
      return response(await tx.product.create({ select, data: { name: input.name, price: new Prisma.Decimal(input.price), imageUrl: input.imageUrl, stock: 0,
        sizes: { create: input.sizes.map(s => ({ size: s.size, extraPrice: new Prisma.Decimal(s.extraPrice) })) },
        toppings: { create: ids.map(toppingId => ({ toppingId })) } } }));
    }));
  }
  private async current(tx: Prisma.TransactionClient, id: string, expectedVersion: number) {
    // Parent serialization protects explicit config cleanup from concurrent FK
    // consumers. No actor/user lock, so no inversion with customer write paths.
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.product.findUnique({ where: { id }, select });
    if (!row) throw missing();
    if (row.version !== expectedVersion) throw conflict();
    return row;
  }
  update(id: string, input: ProductUpdateDto) {
    if (input.name === undefined && input.price === undefined && input.imageUrl === undefined && input.isActive === undefined) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Supply a mutable Product field' });
    return this.safely(() => this.transaction(async tx => {
      const row = await this.current(tx, id, input.expectedVersion);
      if (row.version >= 2147483647) throw unavailable();
      if (input.isActive === true && !row.sizes.some(s => s.isActive && ['S', 'M', 'L'].includes(s.size))) throw inUse();
      const changed = await tx.product.updateMany({ where: { id, version: input.expectedVersion }, data: {
        ...(input.name === undefined ? {} : { name: input.name }), ...(input.price === undefined ? {} : { price: new Prisma.Decimal(input.price) }),
        ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }), ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        version: { increment: 1 }, updatedAt: new Date() } });
      if (changed.count !== 1) throw conflict();
      return response(await tx.product.findUniqueOrThrow({ where: { id }, select }));
    }));
  }
  remove(id: string, expectedVersion: number) {
    return this.safely(() => this.transaction(async tx => {
      await this.current(tx, id, expectedVersion);
      if (await tx.orderItem.count({ where: { productId: id } }) || await tx.cartItem.count({ where: { productId: id } })) throw inUse();
      await tx.productTopping.deleteMany({ where: { productId: id } });
      await tx.productSize.deleteMany({ where: { productId: id } });
      if ((await tx.product.deleteMany({ where: { id, version: expectedVersion } })).count !== 1) throw conflict();
    }));
  }
}

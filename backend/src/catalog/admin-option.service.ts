import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, type ProductSize } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { AdminSizeCreateDto, AdminSizeUpdateDto, ToppingCreateDto, ToppingUpdateDto } from './admin-option.dto';

function compareIds(a: string, b: string) {
  const na = /^\d+$/.test(a) ? Number(a) : Number.POSITIVE_INFINITY;
  const nb = /^\d+$/.test(b) ? Number(b) : Number.POSITIVE_INFINITY;
  return na !== nb ? na - nb : a.localeCompare(b);
}

const topSelect = { id: true, name: true, price: true, isActive: true, version: true, createdAt: true, updatedAt: true } satisfies Prisma.ToppingSelect;
type ToppingRow = Prisma.ToppingGetPayload<{ select: typeof topSelect }>;
const conflict = () => new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Configuration changed; reload and confirm again' });
const inUse = () => new ConflictException({ code: 'RESOURCE_IN_USE', message: 'Configuration is referenced or is required; deactivate where permitted' });
const missing = (kind: 'PRODUCT' | 'SIZE' | 'TOPPING') => new NotFoundException({ code: `${kind}_NOT_FOUND`, message: `${kind} not found` });
const invalid = () => new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Supply a mutable configuration field' });
const unavailable = () => new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Option management unavailable' });
const sizeDto = (s: ProductSize) => ({ productId: s.productId, size: s.size, extraPrice: s.extraPrice.toFixed(0), isActive: s.isActive });
const topDto = (t: ToppingRow) => ({ id: t.id, name: t.name, price: t.price.toFixed(0), isActive: t.isActive, version: t.version, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() });
@Injectable()
export class AdminOptionService {
  constructor(private readonly db: PrismaService) {}
  private async safely<T>(work: () => Promise<T>) {
    try { return await work(); } catch (e) {
      if (e instanceof HttpException) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        const adapter = e.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
        const code = typeof e.meta?.code === 'string' ? e.meta.code : adapter?.cause?.originalCode;
        if (e.code === 'P2002' || code === '23505') throw new ConflictException({ code: 'RESOURCE_ALREADY_EXISTS', message: 'Configuration already exists' });
        if (e.code === 'P2003' || code === '23503') throw inUse();
        if (['P2028', 'P2034'].includes(e.code) || (code && ['55P03', '57014', '40P01', '40001'].includes(code))) throw conflict();
      }
      throw unavailable();
    }
  }
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.db.$transaction(async tx => {
      await (this.db.transactionOptions?.timeout === 5000
        ? tx.$executeRaw`SELECT set_config('lock_timeout', '2000ms', true), set_config('statement_timeout', '4000ms', true)`
        : tx.$executeRaw`SELECT set_config('lock_timeout', '200ms', true), set_config('statement_timeout', '300ms', true)`);
      return work(tx);
    }, this.db.transactionOptions ?? { maxWait: 50, timeout: 400 });
  }
  private async parent(tx: Prisma.TransactionClient, id: string, version?: number) {
    if (version !== undefined) await tx.$queryRaw`SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
    const p = await tx.product.findUnique({ where: { id }, include: { sizes: true } });
    if (!p) throw missing('PRODUCT');
    if (version !== undefined && p.version !== version) throw conflict();
    return p;
  }
  private async bump(tx: Prisma.TransactionClient, id: string, version: number) {
    if (version >= 2147483647) throw unavailable();
    if ((await tx.product.updateMany({ where: { id, version }, data: { version: { increment: 1 }, updatedAt: new Date() } })).count !== 1) throw conflict();
    return version + 1;
  }
  sizes(id: string) {
    return this.safely(async () => {
      const p = await this.db.product.findUnique({ where: { id }, select: { version: true, sizes: true } });
      if (!p) throw missing('PRODUCT');
      return { items: p.sizes.sort((a, b) => ['S', 'M', 'L'].indexOf(a.size) - ['S', 'M', 'L'].indexOf(b.size)).map(sizeDto), productVersion: p.version };
    });
  }
  createSize(id: string, body: AdminSizeCreateDto) {
    return this.safely(() => this.transaction(async tx => {
      await this.parent(tx, id, body.expectedVersion);
      const row = await tx.productSize.create({ data: { productId: id, size: body.size, extraPrice: new Prisma.Decimal(body.extraPrice) } });
      return { item: sizeDto(row), productVersion: await this.bump(tx, id, body.expectedVersion) };
    }));
  }
  updateSize(id: string, size: string, body: AdminSizeUpdateDto) {
    if (body.extraPrice === undefined && body.isActive === undefined) throw invalid();
    return this.safely(() => this.transaction(async tx => {
      const p = await this.parent(tx, id, body.expectedVersion); const row = p.sizes.find(s => s.size === size);
      if (!row) throw missing('SIZE');
      if (body.isActive === false && row.isActive && p.isActive && p.sizes.filter(s => s.isActive).length <= 1) throw inUse();
      const current = await tx.productSize.update({ where: { productId_size: { productId: id, size } }, data: {
        ...(body.extraPrice === undefined ? {} : { extraPrice: new Prisma.Decimal(body.extraPrice) }), ...(body.isActive === undefined ? {} : { isActive: body.isActive }) } });
      return { item: sizeDto(current), productVersion: await this.bump(tx, id, body.expectedVersion) };
    }));
  }
  deleteSize(id: string, size: string, version: number) {
    return this.safely(() => this.transaction(async tx => {
      const p = await this.parent(tx, id, version); const row = p.sizes.find(s => s.size === size); if (!row) throw missing('SIZE');
      if (p.sizes.length <= 1 || (p.isActive && row.isActive && p.sizes.filter(s => s.isActive).length <= 1)
        || await tx.cartItem.count({ where: { productId: id, size } }) || await tx.orderItem.count({ where: { productId: id, size } })) throw inUse();
      await tx.productSize.delete({ where: { productId_size: { productId: id, size } } }); await this.bump(tx, id, version);
    }));
  }
  toppings() {
    return this.safely(async () => {
      const rows = await this.db.topping.findMany({ select: topSelect });
      rows.sort((a, b) => compareIds(a.id, b.id));
      return { items: rows.map(topDto) };
    });
  }
  topping(id: string) { return this.safely(async () => { const row = await this.db.topping.findUnique({ where: { id }, select: topSelect }); if (!row) throw missing('TOPPING'); return topDto(row); }); }
  createTopping(body: ToppingCreateDto) { return this.safely(async () => topDto(await this.db.topping.create({ select: topSelect, data: { name: body.name, price: new Prisma.Decimal(body.price) } }))); }
  private async currentTopping(tx: Prisma.TransactionClient, id: string, version: number) {
    await tx.$queryRaw`SELECT id FROM toppings WHERE id = ${id} FOR UPDATE`;
    const row = await tx.topping.findUnique({ where: { id }, select: topSelect }); if (!row) throw missing('TOPPING'); if (row.version !== version) throw conflict(); return row;
  }
  updateTopping(id: string, body: ToppingUpdateDto) {
    if (body.name === undefined && body.price === undefined && body.isActive === undefined) throw invalid();
    return this.safely(() => this.transaction(async tx => {
      const row = await this.currentTopping(tx, id, body.expectedVersion); if (row.version >= 2147483647) throw unavailable();
      const changed = await tx.topping.updateMany({ where: { id, version: body.expectedVersion }, data: {
        ...(body.name === undefined ? {} : { name: body.name }), ...(body.price === undefined ? {} : { price: new Prisma.Decimal(body.price) }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }), version: { increment: 1 }, updatedAt: new Date() } });
      if (changed.count !== 1) throw conflict(); return topDto(await tx.topping.findUniqueOrThrow({ where: { id }, select: topSelect }));
    }));
  }
  deleteTopping(id: string, version: number) {
    return this.safely(() => this.transaction(async tx => {
      await this.currentTopping(tx, id, version);
      if (await tx.productTopping.count({ where: { toppingId: id } }) || await tx.cartItemTopping.count({ where: { toppingId: id } }) || await tx.orderItemTopping.count({ where: { toppingId: id } })) throw inUse();
      if ((await tx.topping.deleteMany({ where: { id, version } })).count !== 1) throw conflict();
    }));
  }
  private async associations(tx: Prisma.TransactionClient, id: string, version: number) {
    const rows = await tx.productTopping.findMany({ where: { productId: id }, include: { topping: { select: topSelect } } });
    rows.sort((a, b) => compareIds(a.toppingId, b.toppingId));
    return { items: rows.map(r => topDto(r.topping)), productVersion: version };
  }
  productToppings(id: string) {
    return this.safely(async () => {
      const p = await this.db.product.findUnique({
        where: { id },
        select: { version: true, toppings: { include: { topping: { select: topSelect } } } },
      });
      if (!p) throw missing('PRODUCT');
      const sorted = [...p.toppings].sort((a, b) => compareIds(a.toppingId, b.toppingId));
      return { items: sorted.map(r => topDto(r.topping)), productVersion: p.version };
    });
  }
  attach(id: string, toppingId: string, version: number) {
    return this.safely(() => this.transaction(async tx => {
      await this.parent(tx, id, version);
      if (!await tx.topping.findUnique({ where: { id: toppingId }, select: { id: true } })) throw missing('TOPPING');
      await tx.productTopping.create({ data: { productId: id, toppingId } });
      return this.associations(tx, id, await this.bump(tx, id, version));
    }));
  }
  detach(id: string, toppingId: string, version: number) {
    return this.safely(() => this.transaction(async tx => {
      await this.parent(tx, id, version);
      if (!await tx.productTopping.findUnique({ where: { productId_toppingId: { productId: id, toppingId } } })) throw missing('TOPPING');
      if (await tx.cartItem.count({ where: { productId: id, toppings: { some: { toppingId } } } }) || await tx.orderItem.count({ where: { productId: id, toppings: { some: { toppingId } } } })) throw inUse();
      await tx.productTopping.delete({ where: { productId_toppingId: { productId: id, toppingId } } }); await this.bump(tx, id, version);
    }));
  }
}

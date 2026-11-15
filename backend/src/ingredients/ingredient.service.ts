<<<<<<< HEAD
import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
=======
import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
>>>>>>> origin/main
import { Prisma, type Ingredient, type IngredientCountStatus, type UserRole } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { requireIdempotencyKey } from '../common/idempotency';
import type { CountCreateDto, CountReviewDto, IngredientControlDto, IngredientCreateDto, ReceiptCreateDto } from './ingredient.dto';
import { readIngredientCatalog } from './ingredient-catalog';
import { countVariance, inventoryDayStart, isWaterMaterial, reconciledCountQuantity, supportsInventoryCount } from './inventory-control';
import { actorSelect, checkHash, historicalIngredientThresholds, ingredientThreshold, invalidState, quantity, requestHash, stockChanged, stockStatus, uniqueLines, unitThreshold } from './ingredient-policy';

const ingredientSelect = { id: true, name: true, unit: true, quantity: true, version: true } as const;
const movementInclude = { actor: { select: actorSelect } } as const;
const receiptInclude = { createdBy: { select: actorSelect }, confirmedBy: { select: actorSelect }, lines: { orderBy: { ingredientId: 'asc' }, include: { ingredient: { select: ingredientSelect }, movement: { include: movementInclude } } } } as const;
const countInclude = { createdBy: { select: actorSelect }, reviewedBy: { select: actorSelect }, replacement: { select: { id: true } }, lines: { orderBy: { ingredientId: 'asc' }, include: { ingredient: { select: ingredientSelect }, movement: { include: movementInclude } } } } as const;
type Receipt = Prisma.IngredientReceiptGetPayload<{ include: typeof receiptInclude }>;
type Count = Prisma.IngredientCountGetPayload<{ include: typeof countInclude }>;
type Movement = Prisma.IngredientMovementGetPayload<{ include: typeof movementInclude }>;
type Tx = Prisma.TransactionClient;
const displayName = (name: string) => readIngredientCatalog().find(entry => entry.name === name)?.displayName ?? name;
const unavailable = () => new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Chưa xác nhận được kết quả. Giữ nguyên yêu cầu và thử lại.' });
function movementDto(m: Movement) { return { id: m.id, beforeQuantity: m.beforeQuantity.toFixed(3), afterQuantity: m.afterQuantity.toFixed(3), delta: m.delta.toFixed(3), actor: m.actor, createdAt: m.createdAt.toISOString() }; }
function receiptDto(r: Receipt) { return { id: r.id, status: r.status, note: r.note, version: r.version, createdBy: r.createdBy, confirmedBy: r.confirmedBy, createdAt: r.createdAt.toISOString(), confirmedAt: r.confirmedAt?.toISOString() ?? null,
  lines: r.lines.map(l => ({ id: l.id, ingredient: { ...l.ingredient, name: displayName(l.ingredient.name), quantity: l.ingredient.quantity.toFixed(3) }, quantity: l.quantity.toFixed(3), movement: l.movement ? movementDto(l.movement) : null })) }; }
function countDto(c: Count) { return { id: c.id, status: c.status, note: c.note, version: c.version, createdBy: c.createdBy, reviewedBy: c.reviewedBy, reviewNote: c.reviewNote, createdAt: c.createdAt.toISOString(), reviewedAt: c.reviewedAt?.toISOString() ?? null, submittedAt: c.submittedAt?.toISOString() ?? null, periodStart: c.periodStart?.toISOString() ?? null, recountRequested: c.recountRequested || c.status === 'RECOUNT_REQUIRED', recountOfId: c.recountOfId, replacementId: c.replacement?.id ?? null,
  lines: c.lines.map(l => ({ id: l.id, ingredient: { ...l.ingredient, name: displayName(l.ingredient.name), quantity: l.ingredient.quantity.toFixed(3) }, systemQuantity: l.systemQuantity.toFixed(3), actualQuantity: l.actualQuantity.toFixed(3), ...countVariance(l.actualQuantity, l.systemQuantity, l.theoreticalConsumption, l.variancePercentThreshold, l.varianceAbsoluteThreshold, l.ingredient.unit), theoreticalConsumption: l.theoreticalConsumption?.toFixed(3) ?? null, variancePercentThreshold: l.variancePercentThreshold?.toFixed(3) ?? null, varianceAbsoluteThreshold: l.varianceAbsoluteThreshold?.toFixed(3) ?? null, canReconcile: l.movementSequence !== null, ingredientVersion: l.ingredientVersion, stale: l.ingredient.version !== l.ingredientVersion, note: l.note, movement: l.movement ? movementDto(l.movement) : null })) }; }

@Injectable()
export class IngredientService {
  constructor(private readonly db: PrismaService) {}
  private async read<T>(work: () => Promise<T>): Promise<T> { try { return await work(); } catch (e) { if (e instanceof HttpException) throw e; throw unavailable(); } }
  private async transaction<T>(actorId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    try { return await this.db.$transaction(async tx => {
<<<<<<< HEAD
      await tx.$executeRaw`SELECT set_config('lock_timeout','200ms',true), set_config('statement_timeout','300ms',true)`;
      // The shared development database also contains TEXT identity columns.
      await tx.$queryRaw`SELECT id FROM users WHERE id::text=${actorId} FOR UPDATE`;
=======
      await (this.db.transactionOptions?.timeout === 5000
        ? tx.$executeRaw`SELECT set_config('lock_timeout','2000ms',true), set_config('statement_timeout','4000ms',true)`
        : tx.$executeRaw`SELECT set_config('lock_timeout','200ms',true), set_config('statement_timeout','300ms',true)`);
      await lockUser(tx, actorId);
>>>>>>> origin/main
      return work(tx);
    }, this.db.transactionOptions ?? { maxWait: 2000, timeout: 5000 }); }
    catch (e) {
      if (e instanceof HttpException) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        const adapter = e.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
        const sqlState = typeof e.meta?.code === 'string' ? e.meta.code : adapter?.cause?.originalCode;
        if (['P2002', 'P2028', 'P2034'].includes(e.code) || ['55P03', '57014', '40P01', '40001'].includes(sqlState ?? '')) {
          throw new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Có cập nhật đồng thời. Tải lại; giữ nguyên mã yêu cầu nếu kết quả chưa rõ.' });
        }
      }
      throw unavailable();
    }
  }
  async ingredients() {
    return this.read(async () => {
      const catalog = new Map(readIngredientCatalog().map(entry => [entry.normalizedName, entry]));
      const rows = await this.db.ingredient.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], include: { createdBy: { select: actorSelect }, movements: { take: 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: movementInclude } } });
      return { items: rows.map(i => {
        const entry = catalog.get(i.normalizedName);
        const isListed = entry?.unit === i.unit;
        const lowStockInclusive = !!(isListed && i.unit !== 'PIECE' && entry.lowStockThreshold !== undefined || Object.hasOwn(historicalIngredientThresholds,i.normalizedName+'|'+i.unit));
        const available = i.quantity.minus(i.reservedQuantity ?? 0);
        return { id: i.id, name: i.name, displayName: isListed ? entry.displayName : i.name, isListed, unit: i.unit, quantity: i.quantity.toFixed(3), reservedQuantity: (i.reservedQuantity ?? new Prisma.Decimal(0)).toFixed(3), availableQuantity: available.toFixed(3), lowStockThreshold: i.lowStockThreshold.toFixed(3), lowStockInclusive, variancePercentThreshold: i.variancePercentThreshold?.toFixed(3) ?? null, varianceAbsoluteThreshold: i.varianceAbsoluteThreshold?.toFixed(3) ?? null, version: i.version, status: stockStatus(available, i.lowStockThreshold, lowStockInclusive), createdBy: i.createdBy, updatedBy: i.movements[0]?.actor ?? i.createdBy, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() };
      }) };
    });
  }
  async summary(actorId: string, role: UserRole) {
    return this.read(async () => {
      const materials = [...readIngredientCatalog().filter(i => i.unit !== 'PIECE' && i.lowStockThreshold !== undefined), ...Object.keys(historicalIngredientThresholds).map(key => { const [normalizedName,unit] = key.split('|'); return { normalizedName,unit }; })];
      const inclusive = materials.length ? Prisma.sql`(normalized_name,unit::text) IN (${Prisma.join(materials.map(i => Prisma.sql`(${i.normalizedName},${i.unit})`))})` : Prisma.sql`false`;
      const rows = await this.db.$queryRaw<{ totalIngredients: number; inStock: number; lowStock: number; outOfStock: number; pendingCounts: number }[]>`
        SELECT count(*)::integer AS "totalIngredients",
<<<<<<< HEAD
          count(*) FILTER (WHERE quantity-reserved_quantity>0 AND (quantity-reserved_quantity>low_stock_threshold OR (NOT ${inclusive} AND quantity-reserved_quantity=low_stock_threshold)))::integer AS "inStock",
          count(*) FILTER (WHERE quantity-reserved_quantity>0 AND (quantity-reserved_quantity<low_stock_threshold OR (${inclusive} AND quantity-reserved_quantity=low_stock_threshold)))::integer AS "lowStock",
          count(*) FILTER (WHERE quantity-reserved_quantity=0)::integer AS "outOfStock",
          (SELECT count(*)::integer FROM ingredient_counts WHERE status='SUBMITTED' AND (${role === 'ADMIN'} OR created_by_id::text=${actorId})) AS "pendingCounts"
=======
          count(*) FILTER (WHERE quantity>=low_stock_threshold AND quantity>0)::integer AS "inStock",
          count(*) FILTER (WHERE quantity>0 AND quantity<low_stock_threshold)::integer AS "lowStock",
          count(*) FILTER (WHERE quantity=0)::integer AS "outOfStock",
          (SELECT count(*)::integer FROM ingredient_counts WHERE status='SUBMITTED' AND (${role === 'ADMIN'} OR created_by_id=${actorId})) AS "pendingCounts"
>>>>>>> origin/main
        FROM ingredients`;
      return rows[0];
    });
  }
  async createIngredient(actorId: string, key: string | undefined, input: IngredientCreateDto) {
    requireIdempotencyKey(key);
    const name = input.name.trim().replace(/\s+/g, ' '); if (!name) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Tên nguyên liệu không được trống.' });
    const threshold = input.lowStockThreshold === undefined ? ingredientThreshold(name, input.unit) : quantity(input.lowStockThreshold, input.unit);
    const hash = requestHash({ name, unit: input.unit, threshold: threshold.toFixed(3) });
    return this.transaction(actorId, async tx => {
      const prior = await tx.ingredient.findUnique({ where: { createdById_requestKey: { createdById: actorId, requestKey: key } } });
      if (prior) {
        const legacyHash = requestHash({ name, unit: input.unit, threshold: unitThreshold(input.unit).toFixed(3) });
        if (input.lowStockThreshold !== undefined || prior.requestHash !== legacyHash) checkHash(prior.requestHash, hash);
        return { id: prior.id };
      }
      if (!['PIECE','L','KG','EGG','BOTTLE','BAG'].includes(input.unit) || !threshold.equals(ingredientThreshold(name, input.unit))) throw new BadRequestException({code:'VALIDATION_ERROR',message:'Ngưỡng cảnh báo được áp dụng theo từng mặt hàng và đơn vị hiện có.'});
      const normalizedName = name.normalize('NFC').toLocaleLowerCase('vi');
      if (await tx.ingredient.findUnique({ where: { normalizedName } })) throw new ConflictException({ code: 'INGREDIENT_EXISTS', message: 'Nguyên liệu đã tồn tại.' });
      const i = await tx.ingredient.create({ data: { name, normalizedName, unit: input.unit, lowStockThreshold: threshold, createdById: actorId, requestKey: key, requestHash: hash } });
      return { id: i.id };
    });
  }
  async initializeCatalog(actorId:string) {
    return this.transaction(actorId,async tx=>{
      const definitions=readIngredientCatalog().map(({name,unit,normalizedName})=>({name,unit,normalizedName}));
      const existing=await tx.ingredient.findMany({where:{normalizedName:{in:definitions.map(i=>i.normalizedName)}}});
      for(const item of definitions){
        const found=existing.find(i=>i.normalizedName===item.normalizedName);
        if(found&&found.unit!==item.unit)throw new ConflictException({code:'INGREDIENT_UNIT_MISMATCH',message:`${item.name} đã tồn tại với đơn vị khác. Giữ nguyên tồn và lịch sử; cần đối chiếu đơn vị trước khi bổ sung danh mục.`});
      }
      const missing=definitions.filter(i=>!existing.some(e=>e.normalizedName===i.normalizedName));
      const created=missing.length?(await tx.ingredient.createMany({skipDuplicates:true,data:missing.map(i=>({
<<<<<<< HEAD
        ...i,id:randomUUID(),createdById:actorId,lowStockThreshold:ingredientThreshold(i.name,i.unit),
        requestKey:'catalog-v1:'+requestHash(i.normalizedName),requestHash:requestHash({name:i.name,unit:i.unit,threshold:ingredientThreshold(i.name,i.unit).toFixed(3)}),
=======
        ...i,createdById:actorId,lowStockThreshold:unitThreshold(i.unit),
        requestKey:'catalog-v1:'+requestHash(i.normalizedName),requestHash:requestHash({name:i.name,unit:i.unit,threshold:unitThreshold(i.unit).toFixed(3)}),
>>>>>>> origin/main
      }))})).count:0;
      if(missing.length){
        const saved=await tx.ingredient.findMany({where:{normalizedName:{in:definitions.map(i=>i.normalizedName)}}});
        if(definitions.some(i=>!saved.some(s=>s.normalizedName===i.normalizedName&&s.unit===i.unit)))throw new ConflictException({code:'INGREDIENT_UNIT_MISMATCH',message:'Danh mục có xung đột. Không thay đổi lượng tồn hoặc đơn vị hàng đã có.'});
      }
      return {created,existing:definitions.length-created};
    });
  }
  async configureControl(actorId: string, id: string, input: IngredientControlDto) {
    return this.transaction(actorId, async tx => {
      const ingredient = (await this.ingredientRows(tx, [id], true)).get(id)!;
      if (!supportsInventoryCount(ingredient)) throw new UnprocessableEntityException({ code: 'INVENTORY_COUNT_NOT_SUPPORTED', message: 'Chỉ kiểm soát chênh lệch nguyên liệu; không áp dụng đá viên, nước lọc và vật dụng.' });
      const percent = input.variancePercentThreshold == null ? null : new Prisma.Decimal(input.variancePercentThreshold);
      const absolute = input.varianceAbsoluteThreshold == null ? null : quantity(input.varianceAbsoluteThreshold, ingredient.unit);
      if (percent !== null && percent.gt(1000)) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Ngưỡng tỷ lệ chênh lệch phải từ 0 đến 1000%.' });
      }
      const sameDecimal = (a: Prisma.Decimal | null, b: Prisma.Decimal | null) => a === null ? b === null : b !== null && a.equals(b);
      if (ingredient.version === input.expectedVersion + 1 && sameDecimal(ingredient.variancePercentThreshold, percent) && sameDecimal(ingredient.varianceAbsoluteThreshold, absolute)) return { id, version: ingredient.version };
      if (ingredient.version !== input.expectedVersion) throw stockChanged();
      const result = await tx.ingredient.updateMany({ where: { id, version: input.expectedVersion }, data: {
        variancePercentThreshold: percent, varianceAbsoluteThreshold: absolute,
        version: { increment: 1 }, updatedAt: new Date(),
      } });
      if (result.count !== 1) throw stockChanged();
      return { id, version: input.expectedVersion + 1 };
    });
  }
  private async ingredientRows(tx: Tx, ids: string[], lock: boolean) {
    const sorted = [...ids].sort();
<<<<<<< HEAD
    if (lock) await tx.$queryRaw(Prisma.sql`SELECT id FROM ingredients WHERE id::text IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`);
=======
    if (lock) await tx.$queryRaw(Prisma.sql`SELECT id FROM ingredients WHERE id IN (${Prisma.join(sorted.map(id => Prisma.sql`${id}`))}) ORDER BY id FOR UPDATE`);
>>>>>>> origin/main
    const rows = await tx.ingredient.findMany({ where: { id: { in: sorted } }, orderBy: { id: 'asc' } });
    if (rows.length !== ids.length) throw new NotFoundException({ code: 'INGREDIENT_NOT_FOUND', message: 'Không tìm thấy nguyên liệu.' });
    return new Map(rows.map(i => [i.id, i]));
  }
  private async documentLock(tx: Tx, kind: 'receipt' | 'count', id: string, ownerId?: string) {
<<<<<<< HEAD
    if (kind === 'receipt') await tx.$queryRaw`SELECT id FROM ingredient_receipts WHERE id::text=${id} FOR UPDATE`;
    else if (ownerId) await tx.$queryRaw`SELECT id FROM ingredient_counts WHERE id::text=${id} AND created_by_id::text=${ownerId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM ingredient_counts WHERE id::text=${id} FOR UPDATE`;
=======
    if (kind === 'receipt') await tx.$queryRaw`SELECT id FROM ingredient_receipts WHERE id=${id} FOR UPDATE`;
    else if (ownerId) await tx.$queryRaw`SELECT id FROM ingredient_counts WHERE id=${id} AND created_by_id=${ownerId} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM ingredient_counts WHERE id=${id} FOR UPDATE`;
>>>>>>> origin/main
  }
  async createReceipt(actorId: string, key: string | undefined, input: ReceiptCreateDto) {
    requireIdempotencyKey(key); uniqueLines(input.lines);
    const lines = input.lines.map(l => ({ ingredientId: l.ingredientId.toLowerCase(), quantity: quantity(l.quantity, 'KG').toFixed(3) })).sort((a,b) => a.ingredientId.localeCompare(b.ingredientId));
    const note = input.note?.trim() ?? '', hash = requestHash({ note, lines });
    return this.transaction(actorId, async tx => {
      const prior = await tx.ingredientReceipt.findUnique({ where: { createdById_requestKey: { createdById: actorId, requestKey: key } }, include: receiptInclude });
      if (prior) { checkHash(prior.requestHash, hash); return receiptDto(prior); }
      const ingredients = await this.ingredientRows(tx, lines.map(l => l.ingredientId), false);
      for (const l of lines) {
        const ingredient = ingredients.get(l.ingredientId)!;
        if (isWaterMaterial(ingredient.name)) throw new UnprocessableEntityException({code:'INGREDIENT_NOT_RECEIVABLE',message:'Nước lọc không thuộc danh mục nhập hàng.'});
        quantity(l.quantity, ingredient.unit, true);
      }
      const doc = await tx.ingredientReceipt.create({ data: { createdById: actorId, requestKey: key, requestHash: hash, note } });
      await tx.ingredientReceiptLine.createMany({ data: lines.map(l => ({ ...l, receiptId: doc.id })) });
      return receiptDto(await tx.ingredientReceipt.findUniqueOrThrow({ where: { id: doc.id }, include: receiptInclude }));
    });
  }
  // One bulk CAS and one movement batch: bounded round trips for up to50 lines.
  private async applyStock(tx: Tx, updates: { ingredient: Ingredient; after: Prisma.Decimal; source: { receiptLineId: string } | { countLineId: string } }[], actorId: string, now: Date) {
    for (const u of updates) if (u.ingredient.version >= 2147483647 || u.after.isNegative() || u.after.gt('999999999.999')) throw new ConflictException({ code: 'INVALID_QUANTITY', message: 'Tồn kho vượt giới hạn cho phép.' });
    const rows = updates.map(u => Prisma.sql`(${u.ingredient.id}::text,${u.ingredient.version}::integer,${u.after.toFixed(3)}::numeric)`);
<<<<<<< HEAD
    const changed = await tx.$executeRaw(Prisma.sql`UPDATE ingredients AS i SET quantity=v.quantity,version=i.version+1,updated_at=${now} FROM (VALUES ${Prisma.join(rows)}) AS v(id,version,quantity) WHERE i.id::text=v.id AND i.version=v.version`);
=======
    const changed = await tx.$executeRaw(Prisma.sql`UPDATE ingredients AS i SET quantity=v.quantity,version=i.version+1,updated_at=${now} FROM (VALUES ${Prisma.join(rows)}) AS v(id,version,quantity) WHERE i.id=v.id AND i.version=v.version`);
>>>>>>> origin/main
    if (changed !== updates.length) throw stockChanged();
    await tx.ingredientMovement.createMany({ data: updates.map(u => ({ ingredientId: u.ingredient.id, ...u.source, beforeQuantity: u.ingredient.quantity, afterQuantity: u.after, delta: u.after.minus(u.ingredient.quantity), actorId, createdAt: now })) });
  }
  async confirmReceipt(actorId: string, id: string, expectedVersion: number) {
    return this.transaction(actorId, async tx => {
      await this.documentLock(tx, 'receipt', id);
      const doc = await tx.ingredientReceipt.findUnique({ where: { id }, include: receiptInclude });
      if (!doc) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Không tìm thấy phiếu.' });
      if (doc.status === 'CONFIRMED') return receiptDto(doc);
      if (doc.version !== expectedVersion || !doc.lines.length) throw invalidState();
      const ingredients = await this.ingredientRows(tx, doc.lines.map(l => l.ingredientId), true), now = new Date();
      await this.applyStock(tx, doc.lines.map(l => { const ingredient = ingredients.get(l.ingredientId)!; return { ingredient, after: ingredient.quantity.plus(l.quantity), source: { receiptLineId: l.id } }; }), actorId, now);
      const changed = await tx.ingredientReceipt.updateMany({ where: { id, status: 'DRAFT', version: expectedVersion }, data: { status: 'CONFIRMED', confirmedById: actorId, confirmedAt: now, version: { increment: 1 } } });
      if (changed.count !== 1) throw invalidState();
      return receiptDto(await tx.ingredientReceipt.findUniqueOrThrow({ where: { id }, include: receiptInclude }));
    });
  }
  async createCount(actorId: string, key: string | undefined, input: CountCreateDto) {
    requireIdempotencyKey(key); uniqueLines(input.lines);
    const lines = input.lines.map(l => ({ ingredientId: l.ingredientId.toLowerCase(), actualQuantity: quantity(l.actualQuantity, 'KG').toFixed(3), expectedVersion: l.expectedVersion, note: l.note?.trim() ?? '' })).sort((a,b) => a.ingredientId.localeCompare(b.ingredientId));
    const note = input.note?.trim() ?? '', recountOfId = input.recountOfId?.toLowerCase() ?? null, hash = requestHash({ note, recountOfId, lines, ...(input.saveAsDraft ? { saveAsDraft: true } : {}) });
    return this.transaction(actorId, async tx => {
      const prior = await tx.ingredientCount.findUnique({ where: { createdById_requestKey: { createdById: actorId, requestKey: key } }, include: countInclude });
      if (prior) { checkHash(prior.requestHash, hash); return countDto(prior); }
      if (recountOfId) {
        await this.documentLock(tx, 'count', recountOfId, actorId);
        const old = await tx.ingredientCount.findFirst({ where: { id: recountOfId, createdById: actorId }, include: { replacement: true, lines: true } });
        if (!old) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Không tìm thấy phiếu gốc.' });
        if (!(old.status === 'RECOUNT_REQUIRED' || old.status === 'REJECTED' && old.recountRequested) || old.replacement) throw invalidState();
        if (old.lines.length !== lines.length || old.lines.some(l => !lines.some(n => n.ingredientId === l.ingredientId))) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Phiếu kiểm kê lại phải gồm đúng các nguyên liệu của phiếu gốc.' });
      }
      const ingredients = await this.ingredientRows(tx, lines.map(l => l.ingredientId), true);
<<<<<<< HEAD
      for (const l of lines) { const i = ingredients.get(l.ingredientId)!; quantity(l.actualQuantity, i.unit);
        if (!supportsInventoryCount(i)) throw new UnprocessableEntityException({code:'INVENTORY_COUNT_NOT_SUPPORTED',message:'Không kiểm kê chênh lệch đá viên, nước lọc hoặc vật dụng.'});
        if (i.version !== l.expectedVersion) throw stockChanged(); }
      const now = new Date(), periodStart = inventoryDayStart(now);
      const snapshots = await tx.$queryRaw<{id: string; sequence: bigint; consumed: string}[]>`
        SELECT ingredient_id::text AS id, max(sequence) AS sequence,
          COALESCE(-sum(delta) FILTER (WHERE reservation_action='CONSUME' AND created_at>=${periodStart} AND created_at<=${now}),0)::text AS consumed
        FROM ingredient_movements WHERE ingredient_id::text IN (${Prisma.join(lines.map(l => l.ingredientId))}) GROUP BY ingredient_id`;
      const doc = await tx.ingredientCount.create({ data: { createdById: actorId, requestKey: key, requestHash: hash, note, recountOfId, createdAt: now, periodStart,
        status: input.saveAsDraft ? 'DRAFT' : 'SUBMITTED', submittedAt: input.saveAsDraft ? null : now } });
      await tx.ingredientCountLine.createMany({ data: lines.map(l => {
        const ingredient = ingredients.get(l.ingredientId)!, snapshot = snapshots.find(s => s.id === l.ingredientId);
        return { id: randomUUID(), countId: doc.id, ingredientId: l.ingredientId, actualQuantity: l.actualQuantity, systemQuantity: ingredient.quantity, ingredientVersion: l.expectedVersion, note: l.note,
          movementSequence: snapshot?.sequence ?? 0n, theoreticalConsumption: snapshot?.consumed ?? '0', variancePercentThreshold: ingredient.variancePercentThreshold, varianceAbsoluteThreshold: ingredient.varianceAbsoluteThreshold };
      }) });
=======
      for (const l of lines) { const i = ingredients.get(l.ingredientId)!; quantity(l.actualQuantity, i.unit); if (i.version !== l.expectedVersion) throw stockChanged(); }
      const doc = await tx.ingredientCount.create({ data: { createdById: actorId, requestKey: key, requestHash: hash, note, recountOfId } });
      await tx.ingredientCountLine.createMany({ data: lines.map(l => ({ countId: doc.id, ingredientId: l.ingredientId, actualQuantity: l.actualQuantity, systemQuantity: ingredients.get(l.ingredientId)!.quantity, ingredientVersion: l.expectedVersion, note: l.note })) });
>>>>>>> origin/main
      return countDto(await tx.ingredientCount.findUniqueOrThrow({ where: { id: doc.id }, include: countInclude }));
    });
  }
  async submitCount(actorId: string, id: string, expectedVersion: number) {
    return this.transaction(actorId, async tx => {
      await this.documentLock(tx, 'count', id, actorId);
      const doc = await tx.ingredientCount.findFirst({ where: { id, createdById: actorId }, include: countInclude });
      if (!doc) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Không tìm thấy phiếu.' });
      if (doc.status === 'SUBMITTED' && doc.version === expectedVersion + 1) return countDto(doc);
      if (doc.status !== 'DRAFT' || doc.version !== expectedVersion || !doc.lines.length) throw invalidState();
      const changed = await tx.ingredientCount.updateMany({ where: { id, createdById: actorId, status: 'DRAFT', version: expectedVersion }, data: { status: 'SUBMITTED', submittedAt: new Date(), version: { increment: 1 } } });
      if (changed.count !== 1) throw invalidState();
      return countDto(await tx.ingredientCount.findUniqueOrThrow({ where: { id }, include: countInclude }));
    });
  }
  async reviewCount(actorId: string, id: string, input: CountReviewDto) {
    const note = input.note.trim();
    if (input.action !== 'APPROVE' && !note) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Cần ghi lý do từ chối hoặc yêu cầu kiểm kê lại.' });
    const status: IngredientCountStatus = input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const recountRequested = input.action === 'REQUEST_RECOUNT';
    return this.transaction(actorId, async tx => {
      await this.documentLock(tx, 'count', id);
      const doc = await tx.ingredientCount.findUnique({ where: { id }, include: countInclude });
      if (!doc) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Không tìm thấy phiếu.' });
      if (doc.status === status && doc.reviewNote === note && doc.recountRequested === recountRequested) return countDto(doc);
      if (doc.status !== 'SUBMITTED' || doc.version !== input.expectedVersion || !doc.lines.length) throw invalidState();
      const now = new Date();
      if (status === 'APPROVED') {
        const ingredients = await this.ingredientRows(tx, doc.lines.map(l => l.ingredientId), true);
        const journalConditions = doc.lines.filter(l => l.movementSequence !== null).map(l => ({ ingredientId: l.ingredientId, sequence: { gt: l.movementSequence! } }));
        const journal = journalConditions.length ? await tx.ingredientMovement.findMany({ where: { OR: journalConditions }, orderBy: { sequence: 'asc' },
          select: { ingredientId: true, sequence: true, beforeQuantity: true, afterQuantity: true, delta: true, countLineId: true } }) : [];
        const updates = doc.lines.map(l => {
          const ingredient = ingredients.get(l.ingredientId)!;
          if (l.movementSequence === null && ingredient.version !== l.ingredientVersion) throw stockChanged();
          const after = reconciledCountQuantity(l.systemQuantity, l.actualQuantity, ingredient.quantity, ingredient.reservedQuantity,
            journal.filter(m => m.ingredientId === l.ingredientId));
          return { ingredient, after, source: { countLineId: l.id } };
        });
        await this.applyStock(tx, updates, actorId, now);
      }
      const changed = await tx.ingredientCount.updateMany({ where: { id, status: 'SUBMITTED', version: input.expectedVersion }, data: { status, recountRequested, reviewNote: note, reviewedById: actorId, reviewedAt: now, version: { increment: 1 } } });
      if (changed.count !== 1) throw invalidState();
      return countDto(await tx.ingredientCount.findUniqueOrThrow({ where: { id }, include: countInclude }));
    });
  }
  async receipts(cursor?: string) {
    return this.read(async () => {
      const rows = await this.db.ingredientReceipt.findMany({ include: receiptInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51, ...(cursor ? { cursor: { id: cursor.toLowerCase() }, skip: 1 } : {}) });
      return { items: rows.slice(0,50).map(receiptDto), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  }
  async counts(actorId: string, role: UserRole, cursor?: string) {
    return this.read(async () => {
      const rows = await this.db.ingredientCount.findMany({ where: role === 'ADMIN' ? { status: { not: 'DRAFT' } } : { createdById: actorId }, include: countInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51, ...(cursor ? { cursor: { id: cursor.toLowerCase() }, skip: 1 } : {}) });
      return { items: rows.slice(0,50).map(countDto), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  }
  async movements(cursor?: string) {
    return this.read(async () => {
      const rows = await this.db.ingredientMovement.findMany({ include: { ...movementInclude, ingredient: { select: { id: true, name: true, unit: true } }, receiptLine: { select: { receiptId: true } }, countLine: { select: { countId: true } }, reservation: { select: { orderId: true, quantity: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51, ...(cursor ? { cursor: { id: cursor.toLowerCase() }, skip: 1 } : {}) });
      return { items: rows.slice(0,50).map(m => ({ ...movementDto(m), ingredient: { ...m.ingredient, name: displayName(m.ingredient.name) }, kind: m.reservation ? 'ORDER_' + m.reservationAction : m.receiptLine ? 'RECEIPT' : m.countLine ? 'COUNT' : 'LEGACY', documentId: m.reservation?.orderId ?? m.receiptLine?.receiptId ?? m.countLine?.countId ?? m.id, ...(m.reservation ? { committedQuantity: m.reservation.quantity.toFixed(3) } : {}) })), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  }
}

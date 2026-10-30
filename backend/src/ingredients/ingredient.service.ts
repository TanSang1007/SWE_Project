import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type Ingredient, type IngredientCountStatus, type UserRole } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { requireIdempotencyKey } from '../common/idempotency';
import { lockUser } from '../orders/order-policy';
import type { CountCreateDto, CountReviewDto, IngredientCreateDto, ReceiptCreateDto } from './ingredient.dto';
import { ingredientCatalog } from './ingredient-catalog';
import { actorSelect, checkHash, invalidState, quantity, requestHash, stockChanged, stockStatus, uniqueLines, unitThreshold } from './ingredient-policy';

const ingredientSelect = { id: true, name: true, unit: true, quantity: true, version: true } as const;
const movementInclude = { actor: { select: actorSelect } } as const;
const receiptInclude = { createdBy: { select: actorSelect }, confirmedBy: { select: actorSelect }, lines: { orderBy: { ingredientId: 'asc' }, include: { ingredient: { select: ingredientSelect }, movement: { include: movementInclude } } } } as const;
const countInclude = { createdBy: { select: actorSelect }, reviewedBy: { select: actorSelect }, replacement: { select: { id: true } }, lines: { orderBy: { ingredientId: 'asc' }, include: { ingredient: { select: ingredientSelect }, movement: { include: movementInclude } } } } as const;
type Receipt = Prisma.IngredientReceiptGetPayload<{ include: typeof receiptInclude }>;
type Count = Prisma.IngredientCountGetPayload<{ include: typeof countInclude }>;
type Movement = Prisma.IngredientMovementGetPayload<{ include: typeof movementInclude }>;
type Tx = Prisma.TransactionClient;
const unavailable = () => new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Chưa xác nhận được kết quả. Giữ nguyên yêu cầu và thử lại.' });
function movementDto(m: Movement) { return { id: m.id, beforeQuantity: m.beforeQuantity.toFixed(3), afterQuantity: m.afterQuantity.toFixed(3), delta: m.delta.toFixed(3), actor: m.actor, createdAt: m.createdAt.toISOString() }; }
function receiptDto(r: Receipt) { return { id: r.id, status: r.status, note: r.note, version: r.version, createdBy: r.createdBy, confirmedBy: r.confirmedBy, createdAt: r.createdAt.toISOString(), confirmedAt: r.confirmedAt?.toISOString() ?? null,
  lines: r.lines.map(l => ({ id: l.id, ingredient: { ...l.ingredient, quantity: l.ingredient.quantity.toFixed(3) }, quantity: l.quantity.toFixed(3), movement: l.movement ? movementDto(l.movement) : null })) }; }
function countDto(c: Count) { return { id: c.id, status: c.status, note: c.note, version: c.version, createdBy: c.createdBy, reviewedBy: c.reviewedBy, reviewNote: c.reviewNote, createdAt: c.createdAt.toISOString(), reviewedAt: c.reviewedAt?.toISOString() ?? null, recountOfId: c.recountOfId, replacementId: c.replacement?.id ?? null,
  lines: c.lines.map(l => ({ id: l.id, ingredient: { ...l.ingredient, quantity: l.ingredient.quantity.toFixed(3) }, systemQuantity: l.systemQuantity.toFixed(3), actualQuantity: l.actualQuantity.toFixed(3), difference: l.actualQuantity.minus(l.systemQuantity).toFixed(3), ingredientVersion: l.ingredientVersion, stale: l.ingredient.version !== l.ingredientVersion, note: l.note, movement: l.movement ? movementDto(l.movement) : null })) }; }

@Injectable()
export class IngredientService {
  constructor(private readonly db: PrismaService) {}
  private async read<T>(work: () => Promise<T>): Promise<T> { try { return await work(); } catch (e) { if (e instanceof HttpException) throw e; throw unavailable(); } }
  private async transaction<T>(actorId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    try { return await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('lock_timeout','200ms',true), set_config('statement_timeout','300ms',true)`;
      await lockUser(tx, actorId);
      return work(tx);
    }, this.db.transactionOptions ?? { maxWait: 2000, timeout: 5000 }); }
    catch (e) {
      if (e instanceof HttpException) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2028', 'P2034', 'P2010'].includes(e.code)) throw new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Có cập nhật đồng thời. Tải lại; giữ nguyên mã yêu cầu nếu kết quả chưa rõ.' });
      throw unavailable();
    }
  }
  async ingredients() {
    return this.read(async () => ({ items: (await this.db.ingredient.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], include: { createdBy: { select: actorSelect }, movements: { take: 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: movementInclude } } })).map(i => ({ id: i.id, name: i.name, unit: i.unit, quantity: i.quantity.toFixed(3), lowStockThreshold: i.lowStockThreshold.toFixed(3), version: i.version, status: stockStatus(i.quantity, i.lowStockThreshold), createdBy: i.createdBy, updatedBy: i.movements[0]?.actor ?? i.createdBy, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString() })) }));
  }
  async summary(actorId: string, role: UserRole) {
    return this.read(async () => {
      const rows = await this.db.$queryRaw<{ totalIngredients: number; inStock: number; lowStock: number; outOfStock: number; pendingCounts: number }[]>`
        SELECT count(*)::integer AS "totalIngredients",
          count(*) FILTER (WHERE quantity>=low_stock_threshold AND quantity>0)::integer AS "inStock",
          count(*) FILTER (WHERE quantity>0 AND quantity<low_stock_threshold)::integer AS "lowStock",
          count(*) FILTER (WHERE quantity=0)::integer AS "outOfStock",
          (SELECT count(*)::integer FROM ingredient_counts WHERE status='SUBMITTED' AND (${role === 'ADMIN'} OR created_by_id=${actorId}::uuid)) AS "pendingCounts"
        FROM ingredients`;
      return rows[0];
    });
  }
  async createIngredient(actorId: string, key: string | undefined, input: IngredientCreateDto) {
    requireIdempotencyKey(key);
    const name = input.name.trim().replace(/\s+/g, ' '); if (!name) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Tên nguyên liệu không được trống.' });
    const threshold = input.lowStockThreshold === undefined ? unitThreshold(input.unit) : quantity(input.lowStockThreshold, input.unit);
    const hash = requestHash({ name, unit: input.unit, threshold: threshold.toFixed(3) });
    return this.transaction(actorId, async tx => {
      const prior = await tx.ingredient.findUnique({ where: { createdById_requestKey: { createdById: actorId, requestKey: key } } });
      if (prior) { checkHash(prior.requestHash, hash); return { id: prior.id }; }
      if (!['PIECE','L','KG','EGG'].includes(input.unit) || !threshold.equals(unitThreshold(input.unit))) throw new BadRequestException({code:'VALIDATION_ERROR',message:'Vật dụng dùng cái; nguyên liệu mới dùng lít, kg hoặc quả. Ngưỡng cảnh báo cố định theo đơn vị.'});
      const normalizedName = name.normalize('NFC').toLocaleLowerCase('vi');
      if (await tx.ingredient.findUnique({ where: { normalizedName } })) throw new ConflictException({ code: 'INGREDIENT_EXISTS', message: 'Nguyên liệu đã tồn tại.' });
      const i = await tx.ingredient.create({ data: { name, normalizedName, unit: input.unit, lowStockThreshold: threshold, createdById: actorId, requestKey: key, requestHash: hash } });
      return { id: i.id };
    });
  }
  async initializeCatalog(actorId:string) {
    return this.transaction(actorId,async tx=>{
      const definitions=ingredientCatalog.map(i=>({...i,normalizedName:i.name.normalize('NFC').toLocaleLowerCase('vi')}));
      const existing=await tx.ingredient.findMany({where:{normalizedName:{in:definitions.map(i=>i.normalizedName)}}});
      for(const item of definitions){
        const found=existing.find(i=>i.normalizedName===item.normalizedName);
        if(found&&found.unit!==item.unit)throw new ConflictException({code:'INGREDIENT_UNIT_MISMATCH',message:`${item.name} đã tồn tại với đơn vị khác. Giữ nguyên tồn và lịch sử; cần đối chiếu đơn vị trước khi bổ sung danh mục.`});
      }
      const missing=definitions.filter(i=>!existing.some(e=>e.normalizedName===i.normalizedName));
      const created=missing.length?(await tx.ingredient.createMany({skipDuplicates:true,data:missing.map(i=>({
        ...i,id:randomUUID(),createdById:actorId,lowStockThreshold:unitThreshold(i.unit),
        requestKey:'catalog-v1:'+requestHash(i.normalizedName),requestHash:requestHash({name:i.name,unit:i.unit,threshold:unitThreshold(i.unit).toFixed(3)}),
      }))})).count:0;
      if(missing.length){
        const saved=await tx.ingredient.findMany({where:{normalizedName:{in:definitions.map(i=>i.normalizedName)}}});
        if(definitions.some(i=>!saved.some(s=>s.normalizedName===i.normalizedName&&s.unit===i.unit)))throw new ConflictException({code:'INGREDIENT_UNIT_MISMATCH',message:'Danh mục có xung đột. Không thay đổi lượng tồn hoặc đơn vị hàng đã có.'});
      }
      return {created,existing:definitions.length-created};
    });
  }
  private async ingredientRows(tx: Tx, ids: string[], lock: boolean) {
    const sorted = [...ids].sort();
    if (lock) await tx.$queryRaw(Prisma.sql`SELECT id FROM ingredients WHERE id IN (${Prisma.join(sorted.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`);
    const rows = await tx.ingredient.findMany({ where: { id: { in: sorted } }, orderBy: { id: 'asc' } });
    if (rows.length !== ids.length) throw new NotFoundException({ code: 'INGREDIENT_NOT_FOUND', message: 'Không tìm thấy nguyên liệu.' });
    return new Map(rows.map(i => [i.id, i]));
  }
  private async documentLock(tx: Tx, kind: 'receipt' | 'count', id: string, ownerId?: string) {
    if (kind === 'receipt') await tx.$queryRaw`SELECT id FROM ingredient_receipts WHERE id=${id}::uuid FOR UPDATE`;
    else if (ownerId) await tx.$queryRaw`SELECT id FROM ingredient_counts WHERE id=${id}::uuid AND created_by_id=${ownerId}::uuid FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM ingredient_counts WHERE id=${id}::uuid FOR UPDATE`;
  }
  async createReceipt(actorId: string, key: string | undefined, input: ReceiptCreateDto) {
    requireIdempotencyKey(key); uniqueLines(input.lines);
    const lines = input.lines.map(l => ({ ingredientId: l.ingredientId.toLowerCase(), quantity: quantity(l.quantity, 'KG').toFixed(3) })).sort((a,b) => a.ingredientId.localeCompare(b.ingredientId));
    const note = input.note?.trim() ?? '', hash = requestHash({ note, lines });
    return this.transaction(actorId, async tx => {
      const prior = await tx.ingredientReceipt.findUnique({ where: { createdById_requestKey: { createdById: actorId, requestKey: key } }, include: receiptInclude });
      if (prior) { checkHash(prior.requestHash, hash); return receiptDto(prior); }
      const ingredients = await this.ingredientRows(tx, lines.map(l => l.ingredientId), false);
      for (const l of lines) quantity(l.quantity, ingredients.get(l.ingredientId)!.unit, true);
      const doc = await tx.ingredientReceipt.create({ data: { createdById: actorId, requestKey: key, requestHash: hash, note } });
      await tx.ingredientReceiptLine.createMany({ data: lines.map(l => ({ ...l, id: randomUUID(), receiptId: doc.id })) });
      return receiptDto(await tx.ingredientReceipt.findUniqueOrThrow({ where: { id: doc.id }, include: receiptInclude }));
    });
  }
  // One bulk CAS and one movement batch: bounded round trips for up to50 lines.
  private async applyStock(tx: Tx, updates: { ingredient: Ingredient; after: Prisma.Decimal; source: { receiptLineId: string } | { countLineId: string } }[], actorId: string, now: Date) {
    for (const u of updates) if (u.ingredient.version >= 2147483647 || u.after.isNegative() || u.after.gt('999999999.999')) throw new ConflictException({ code: 'INVALID_QUANTITY', message: 'Tồn kho vượt giới hạn cho phép.' });
    const rows = updates.map(u => Prisma.sql`(${u.ingredient.id}::uuid,${u.ingredient.version}::integer,${u.after.toFixed(3)}::numeric)`);
    const changed = await tx.$executeRaw(Prisma.sql`UPDATE ingredients AS i SET quantity=v.quantity,version=i.version+1,updated_at=${now} FROM (VALUES ${Prisma.join(rows)}) AS v(id,version,quantity) WHERE i.id=v.id AND i.version=v.version`);
    if (changed !== updates.length) throw stockChanged();
    await tx.ingredientMovement.createMany({ data: updates.map(u => ({ id: randomUUID(), ingredientId: u.ingredient.id, ...u.source, beforeQuantity: u.ingredient.quantity, afterQuantity: u.after, delta: u.after.minus(u.ingredient.quantity), actorId, createdAt: now })) });
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
    const note = input.note?.trim() ?? '', recountOfId = input.recountOfId?.toLowerCase() ?? null, hash = requestHash({ note, recountOfId, lines });
    return this.transaction(actorId, async tx => {
      const prior = await tx.ingredientCount.findUnique({ where: { createdById_requestKey: { createdById: actorId, requestKey: key } }, include: countInclude });
      if (prior) { checkHash(prior.requestHash, hash); return countDto(prior); }
      if (recountOfId) {
        await this.documentLock(tx, 'count', recountOfId, actorId);
        const old = await tx.ingredientCount.findFirst({ where: { id: recountOfId, createdById: actorId }, include: { replacement: true, lines: true } });
        if (!old) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Không tìm thấy phiếu gốc.' });
        if (old.status !== 'RECOUNT_REQUIRED' || old.replacement) throw invalidState();
        if (old.lines.length !== lines.length || old.lines.some(l => !lines.some(n => n.ingredientId === l.ingredientId))) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Phiếu kiểm kê lại phải gồm đúng các nguyên liệu của phiếu gốc.' });
      }
      const ingredients = await this.ingredientRows(tx, lines.map(l => l.ingredientId), true);
      for (const l of lines) { const i = ingredients.get(l.ingredientId)!; quantity(l.actualQuantity, i.unit); if (i.version !== l.expectedVersion) throw stockChanged(); }
      const doc = await tx.ingredientCount.create({ data: { createdById: actorId, requestKey: key, requestHash: hash, note, recountOfId } });
      await tx.ingredientCountLine.createMany({ data: lines.map(l => ({ id: randomUUID(), countId: doc.id, ingredientId: l.ingredientId, actualQuantity: l.actualQuantity, systemQuantity: ingredients.get(l.ingredientId)!.quantity, ingredientVersion: l.expectedVersion, note: l.note })) });
      return countDto(await tx.ingredientCount.findUniqueOrThrow({ where: { id: doc.id }, include: countInclude }));
    });
  }
  async reviewCount(actorId: string, id: string, input: CountReviewDto) {
    const note = input.note.trim();
    if (input.action !== 'APPROVE' && !note) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Cần ghi lý do từ chối hoặc yêu cầu kiểm kê lại.' });
    const status: IngredientCountStatus = input.action === 'APPROVE' ? 'APPROVED' : input.action === 'REJECT' ? 'REJECTED' : 'RECOUNT_REQUIRED';
    return this.transaction(actorId, async tx => {
      await this.documentLock(tx, 'count', id);
      const doc = await tx.ingredientCount.findUnique({ where: { id }, include: countInclude });
      if (!doc) throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Không tìm thấy phiếu.' });
      if (doc.status === status && doc.reviewNote === note) return countDto(doc);
      if (doc.status !== 'SUBMITTED' || doc.version !== input.expectedVersion || !doc.lines.length) throw invalidState();
      const now = new Date();
      if (status === 'APPROVED') {
        const ingredients = await this.ingredientRows(tx, doc.lines.map(l => l.ingredientId), true);
        if (doc.lines.some(l => ingredients.get(l.ingredientId)!.version !== l.ingredientVersion)) throw stockChanged();
        await this.applyStock(tx, doc.lines.map(l => ({ ingredient: ingredients.get(l.ingredientId)!, after: l.actualQuantity, source: { countLineId: l.id } })), actorId, now);
      }
      const changed = await tx.ingredientCount.updateMany({ where: { id, status: 'SUBMITTED', version: input.expectedVersion }, data: { status, reviewNote: note, reviewedById: actorId, reviewedAt: now, version: { increment: 1 } } });
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
      const rows = await this.db.ingredientCount.findMany({ where: role === 'ADMIN' ? {} : { createdById: actorId }, include: countInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51, ...(cursor ? { cursor: { id: cursor.toLowerCase() }, skip: 1 } : {}) });
      return { items: rows.slice(0,50).map(countDto), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  }
  async movements(cursor?: string) {
    return this.read(async () => {
      const rows = await this.db.ingredientMovement.findMany({ include: { ...movementInclude, ingredient: { select: { id: true, name: true, unit: true } }, receiptLine: { select: { receiptId: true } }, countLine: { select: { countId: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51, ...(cursor ? { cursor: { id: cursor.toLowerCase() }, skip: 1 } : {}) });
      return { items: rows.slice(0,50).map(m => ({ ...movementDto(m), ingredient: m.ingredient, kind: m.receiptLine ? 'RECEIPT' : 'COUNT', documentId: m.receiptLine?.receiptId ?? m.countLine?.countId })), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  }
}

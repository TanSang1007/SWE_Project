import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { normalizeRecipeName, recipeAmountKey, recipeStorageName, type RecipeAmount } from '../catalog/drink-recipes';

type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, '$queryRaw'>;
type Stock = { id: string; name: string; unit: string; quantity: string; reserved: string; version: number };
type Reservation = { id: string; ingredientId: string; name: string; unit: string; quantity: string; state: string; cycle: number };
type Change = { stock: Stock; reservationId: string; quantity: string; cycle: number; after: string; afterReserved: string };
const unavailable = () => new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'Chưa xác nhận được tồn nguyên liệu. Giữ nguyên yêu cầu và thử lại.' });
const conflict = () => new ConflictException({ code: 'CONCURRENT_UPDATE', message: 'Tồn nguyên liệu đã thay đổi. Hãy kiểm tra lại yêu cầu.' });
const missing = (names: string[]) => new ConflictException({ code: 'OUT_OF_STOCK', message: 'Không đủ nguyên liệu theo size và số lượng đã chọn.', details: { missingIngredients: names } });

export async function orderReservations(db: Reader, orderId: string): Promise<Reservation[]> {
  return db.$queryRaw<Reservation[]>`SELECT id::text,ingredient_id::text AS "ingredientId",name_snapshot AS name,unit_snapshot::text AS unit,quantity::text,state::text,cycle
    FROM order_recipe_ingredients WHERE order_id::text=${orderId} ORDER BY ingredient_id`;
}

export async function heldIngredientQuantities(db: Reader, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.$queryRaw<{ id: string; quantity: string }[]>`SELECT id::text,reserved_quantity::text AS quantity FROM ingredients WHERE id::text IN (${Prisma.join(ids)})`;
  return new Map(rows.map(row => [row.id, new Prisma.Decimal(row.quantity).toFixed(3)]));
}

async function updateStock(tx: Tx, changes: Change[], action: 'RESERVE' | 'RELEASE' | 'CONSUME', actorId: string) {
  if (!changes.length) return;
  if (changes.some(c => c.stock.version >= 2147483647 || new Prisma.Decimal(c.after).isNegative() || new Prisma.Decimal(c.after).gt('999999999.999'))) throw unavailable();
  const values = changes.map(c => Prisma.sql`(${c.stock.id}::text,${c.stock.version}::integer,${c.after}::numeric,${c.afterReserved}::numeric)`);
  const updated = await tx.$executeRaw(Prisma.sql`UPDATE ingredients i SET quantity=v.quantity,reserved_quantity=v.reserved,version=i.version+1,updated_at=now()
    FROM (VALUES ${Prisma.join(values)}) v(id,version,quantity,reserved) WHERE i.id::text=v.id AND i.version=v.version`);
  if (updated !== changes.length) throw conflict();
  const events = changes.map(c => Prisma.sql`(${randomUUID()}::uuid,${c.stock.id}::text,${c.reservationId}::text,${action}::text,${c.cycle}::integer,${c.stock.quantity}::numeric,${c.after}::numeric)`);
  const inserted = await tx.$executeRaw(Prisma.sql`INSERT INTO ingredient_movements(id,ingredient_id,reservation_id,reservation_action,reservation_cycle,before_quantity,after_quantity,delta,actor_id)
    SELECT v.id,i.id,r.id,v.action,v.cycle,v.before,v.after,v.after-v.before,u.id
    FROM (VALUES ${Prisma.join(events)}) v(id,ingredient_id,reservation_id,action,cycle,before,after)
    JOIN ingredients i ON i.id::text=v.ingredient_id JOIN order_recipe_ingredients r ON r.id::text=v.reservation_id
    JOIN users u ON u.id::text=${actorId}`);
  if (inserted !== changes.length) throw unavailable();
}

export async function reserveOrderIngredients(tx: Tx, orderId: string, amounts: readonly RecipeAmount[], actorId: string) {
  if (!amounts.length) return;
  const names = amounts.map(amount => normalizeRecipeName(recipeStorageName(amount.name)));
  const rows = await tx.$queryRaw<Stock[]>`SELECT id::text,name,unit::text,quantity::text,reserved_quantity::text AS reserved,version FROM ingredients WHERE normalized_name IN (${Prisma.join(names)}) ORDER BY id FOR UPDATE`;
  const changes: Change[] = amounts.map(amount => {
    const stock = rows.find(row => normalizeRecipeName(row.name) === normalizeRecipeName(recipeStorageName(amount.name)) && row.unit === amount.unit);
    if (!stock || new Prisma.Decimal(stock.quantity).minus(stock.reserved).lt(amount.quantity)) throw missing([amount.name]);
    return { stock, reservationId: randomUUID(), quantity: amount.quantity, cycle: 1, after: stock.quantity, afterReserved: new Prisma.Decimal(stock.reserved).plus(amount.quantity).toFixed(3) };
  });
  const snapshots = changes.map((c, index) => Prisma.sql`(${c.reservationId}::uuid,${c.stock.id}::text,${amounts[index].name}::text,${c.quantity}::numeric)`);
  const inserted = await tx.$executeRaw(Prisma.sql`INSERT INTO order_recipe_ingredients(id,order_id,ingredient_id,name_snapshot,unit_snapshot,quantity)
    SELECT v.id,o.id,i.id,v.name,i.unit,v.quantity FROM (VALUES ${Prisma.join(snapshots)}) v(id,ingredient_id,name,quantity)
    JOIN ingredients i ON i.id::text=v.ingredient_id JOIN orders o ON o.id::text=${orderId}`);
  if (inserted !== changes.length) throw unavailable();
  await updateStock(tx, changes, 'RESERVE', actorId);
}

// I07/O01: caller giữ khóa User/Order. Dùng lượng snapshot đã chốt, không tính
// lại công thức mới cho đơn cũ. RELEASE chỉ giảm phần giữ; CONSUME giảm cả tồn
// thực tế và phần giữ. CONSUMED không được đưa lại về kho khi duyệt hỗ trợ.
// Unique(reservation_id, action, cycle) bảo vệ journal khỏi ghi lặp khi retry.
export async function changeOrderIngredients(tx: Tx, orderId: string, action: 'RESERVE' | 'RELEASE' | 'CONSUME', actorId: string) {
  const reservations = await orderReservations(tx, orderId);
  if (!reservations.length) return false; // Pre-I07 orders keep their original stock policy.
  const expected = action === 'RESERVE' ? 'RELEASED' : 'RESERVED';
  const target = action === 'RESERVE' ? 'RESERVED' : action === 'RELEASE' ? 'RELEASED' : 'CONSUMED';
  if (reservations.every(row => row.state === target)) return true;
  // Never put consumed ingredients back into the warehouse.
  if (action === 'RELEASE' && reservations.every(row => row.state === 'CONSUMED')) return true;
  if (reservations.some(row => row.state !== expected || row.cycle >= 2147483647)) throw unavailable();
  const ids = reservations.map(row => row.ingredientId);
  const rows = await tx.$queryRaw<Stock[]>`SELECT id::text,name,unit::text,quantity::text,reserved_quantity::text AS reserved,version FROM ingredients WHERE id::text IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const changes: Change[] = reservations.map(row => {
    const stock = rows.find(item => item.id === row.ingredientId && item.unit === row.unit);
    if (!stock) throw unavailable();
    if (action === 'RESERVE' && new Prisma.Decimal(stock.quantity).minus(stock.reserved).lt(row.quantity)) throw missing([row.name]);
    if (action !== 'RESERVE' && new Prisma.Decimal(stock.reserved).lt(row.quantity)) throw unavailable();
    const after = new Prisma.Decimal(stock.quantity).minus(action === 'CONSUME' ? row.quantity : 0).toFixed(3);
    const afterReserved = new Prisma.Decimal(stock.reserved).plus(action === 'RESERVE' ? row.quantity : '-' + row.quantity).toFixed(3);
    return { stock, reservationId: row.id, quantity: row.quantity, cycle: row.cycle + (action === 'RESERVE' ? 1 : 0), after, afterReserved };
  });
  const updated = await tx.$executeRaw`UPDATE order_recipe_ingredients SET state=${target}::"RecipeIngredientState",cycle=cycle+${action === 'RESERVE' ? 1 : 0},updated_at=now()
    WHERE order_id::text=${orderId} AND state::text=${expected}`;
  if (updated !== reservations.length) throw conflict();
  await updateStock(tx, changes, action, actorId);
  return true;
}


export async function canReserveOrderIngredients(db: Reader, orderId: string) {
  const reservations = await orderReservations(db, orderId);
  if (!reservations.length) return undefined;
  const ids = reservations.map(row => row.ingredientId);
  const rows = await db.$queryRaw<Stock[]>`SELECT id::text,name,unit::text,quantity::text,reserved_quantity::text AS reserved,version FROM ingredients WHERE id::text IN (${Prisma.join(ids)})`;
  return reservations.every(row => row.state === 'RELEASED' && rows.some(stock => stock.id === row.ingredientId && stock.unit === row.unit && stock.version < 2147483647 && new Prisma.Decimal(stock.quantity).minus(stock.reserved).gte(row.quantity)));
}

export async function assertHeldOrderIngredients(db: Reader, orderId: string) {
  const reservations = await orderReservations(db, orderId);
  if (!reservations.length) return false;
  const ids = reservations.map(row => row.ingredientId);
  const rows = await db.$queryRaw<Stock[]>`SELECT id::text,name,unit::text,quantity::text,reserved_quantity::text AS reserved,version FROM ingredients WHERE id::text IN (${Prisma.join(ids)})`;
  if (reservations.some(row => row.state !== 'RESERVED' || !rows.some(stock => stock.id === row.ingredientId && stock.unit === row.unit && new Prisma.Decimal(stock.reserved).gte(row.quantity)))) throw unavailable();
  return true;
}

export function reservationRecipeKeys(amounts: readonly RecipeAmount[]) {
  return amounts.map(amount => 'i07:' + recipeAmountKey(amount));
}

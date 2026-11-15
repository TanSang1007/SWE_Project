import type { Prisma } from '../generated/prisma/client';

type RawReader = Pick<Prisma.TransactionClient, '$queryRaw'>;

// `orders.order_code` stays the global DB code (BL001, BL002, ... across all
// customers). Customers see a per-account sequence derived from their own
// orders, ordered by the global sequence id (numeric text: shorter first).
export function formatOrderCode(sequence: number): string {
  return `BL${String(sequence).padStart(3, '0')}`;
}

export async function customerOrderCodes(db: RawReader, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  const codes = new Map<string, string>();
  if (!unique.length) return codes;
  const rows = await db.$queryRaw<{ id: string; seq: number | bigint }[]>`
    SELECT o.id, (SELECT count(*) FROM orders p WHERE p.user_id = o.user_id
      AND (length(p.id), p.id) <= (length(o.id), o.id))::int AS seq
    FROM orders o WHERE o.id = ANY(${unique}::text[])`;
  for (const row of rows) codes.set(row.id, formatOrderCode(Number(row.seq)));
  return codes;
}

export async function customerOrderCode(db: RawReader, id: string, fallback: string): Promise<string> {
  return (await customerOrderCodes(db, [id])).get(id) ?? fallback;
}

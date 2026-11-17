import { Prisma } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/database/prisma.service';
import { IngredientService } from '../src/ingredients/ingredient.service';
import { ingredientThreshold, requestHash } from '../src/ingredients/ingredient-policy';
import { readIngredientCatalog } from '../src/ingredients/ingredient-catalog';

test.each(['KG', 'L'] as const)('%s status uses available stock and excludes equality for old and catalog items', async unit => {
  const threshold = ingredientThreshold('fixture', unit);
  const names = [unit === 'KG' ? 'Bột quế' : 'Sữa tươi', readIngredientCatalog().find(i => i.unit === unit)!.name];
  for (const name of names) {
    const rows = ['0', threshold.minus('0.001').toString(), threshold.toString(), threshold.plus('0.001').toString()].map((available, index) => ({
      id: String(index), name, normalizedName: name.toLocaleLowerCase('vi'), unit,
      quantity: new Prisma.Decimal(available).plus(1), reservedQuantity: new Prisma.Decimal(1),
      lowStockThreshold: threshold, version: 7, movements: [], createdBy: { id: 'actor' },
      createdAt: new Date('2026-11-17T00:00:00Z'), updatedAt: new Date('2026-11-17T00:00:00Z'),
    }));
    const before = JSON.stringify(rows);
    const db = { ingredient: { findMany: jest.fn().mockResolvedValue(rows) } };
    const result = await new IngredientService(db as unknown as PrismaService).ingredients();
    expect(result.items.map(i => i.status)).toEqual(['OUT_OF_STOCK', 'LOW_STOCK', 'IN_STOCK', 'IN_STOCK']);
    expect(result.items.every(i => i.lowStockInclusive === false && i.lowStockThreshold === threshold.toFixed(3))).toBe(true);
    expect(result.items[2].availableQuantity).toBe(threshold.toFixed(3));
    expect(JSON.stringify(rows)).toBe(before);
  }
});

test.each([
  ['Bột quế', 'KG', '0.100'], ['Bột ca cao', 'KG', '1.000'], ['Bột matcha', 'KG', '0.500'],
  ['Đường', 'KG', '5.000'], ['Bột quế', 'KG', '10.000'], ['Cà phê', 'KG', '3.000'],
  ['Sữa tươi', 'L', '10.000'], ['Sữa đặc', 'L', '3.000'], ['Sữa tươi', 'L', '5.000'],
  ['Sữa tươi (công thức)', 'L', '5.000'], ['Đường (công thức)', 'KG', '10.000'],
] as const)('creation replay preserves the original %s request at threshold %s/%s', async (name, unit, oldThreshold) => {
  const prior = { id: 'existing-id', requestHash: requestHash({ name, unit, threshold: oldThreshold }) };
  const tx = { $executeRaw: jest.fn(), $queryRaw: jest.fn(), ingredient: { findUnique: jest.fn().mockResolvedValue(prior), create: jest.fn() } };
  const db = { $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
  const service = new IngredientService(db as unknown as PrismaService);
  await expect(service.createIngredient('actor', 'original-key', { name, unit })).resolves.toEqual({ id: prior.id });
  await expect(service.createIngredient('actor', 'original-key', { name, unit, lowStockThreshold: oldThreshold })).resolves.toEqual({ id: prior.id });
  await expect(service.createIngredient('actor', 'original-key', { name: name + ' khác', unit })).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  await expect(service.createIngredient('actor', 'original-key', { name, unit: unit === 'KG' ? 'L' : 'KG' })).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  expect(tx.ingredient.create).not.toHaveBeenCalled();
});

test.each([['KG', '3.000', '10'], ['L', '2.000', '5']] as const)('new %s ingredients use the new threshold and reject explicit old defaults', async (unit, threshold, oldThreshold) => {
  const create = jest.fn<Promise<{ id: string }>, [Prisma.IngredientCreateArgs]>().mockResolvedValue({ id: 'new-id' });
  const tx = { $executeRaw: jest.fn(), $queryRaw: jest.fn(), ingredient: { findUnique: jest.fn().mockResolvedValue(null), create } };
  const db = { $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
  const service = new IngredientService(db as unknown as PrismaService);
  await expect(service.createIngredient('actor', 'new-key', { name: 'Mặt hàng mới', unit, lowStockThreshold: oldThreshold })).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  expect(tx.ingredient.create).not.toHaveBeenCalled();
  await expect(service.createIngredient('actor', 'new-key', { name: 'Mặt hàng mới', unit })).resolves.toEqual({ id: 'new-id' });
  expect(create.mock.calls[0][0].data.lowStockThreshold).toEqual(new Prisma.Decimal(threshold));
});

import { Prisma } from '../src/generated/prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaService } from '../src/database/prisma.service';
import { IngredientService } from '../src/ingredients/ingredient.service';
import * as catalog from '../src/ingredients/ingredient-catalog';

afterEach(() => jest.restoreAllMocks());

test('active catalog matches the supplied file with the approved water exclusion and separate identities', () => {
  const source = readFileSync(resolve(__dirname,'../../NGUYÊN LIỆU PHA CHẾ.txt'),'utf8');
  const expected = source.split(/\r?\n/).flatMap(line => { const match = /^(.+?): (kg|l|cái)$/.exec(line); return match ? [match[1]+'|'+({kg:'KG',l:'L',cái:'PIECE'} as Record<string,string>)[match[2]]] : []; });
  const entries = catalog.readIngredientCatalog();
  expect(entries.map(entry => entry.displayName+'|'+entry.unit).sort()).toEqual(expected.filter(item=>item!=='Nước lọc|L').sort());
  expect(entries.every(entry => entry.name.endsWith(' (công thức)'))).toBe(true);
  expect(entries.filter(entry => entry.unit === 'PIECE')).toHaveLength(6);
  expect(entries.filter(entry => entry.unit !== 'PIECE')).toHaveLength(12);
  expect(entries.some(entry=>entry.displayName==='Nước lọc')).toBe(false);
});

test('catalog normalizes identity, supports display labels, and accepts an empty list', () => {
  expect(catalog.readIngredientCatalog([{ name: '  Ly   nhựa  ', label: 'Ly kèm nắp', unit: 'PIECE' }]))
    .toEqual([{ name: 'Ly nhựa', normalizedName: 'ly nhựa', displayName: 'Ly kèm nắp', unit: 'PIECE' }]);
  expect(catalog.readIngredientCatalog([])).toEqual([]);
});

test('invalid or duplicate catalog definitions fail before creating any item', () => {
  for (const entries of [
    [{ name: '', unit: 'L' as const }],
    [{ name: 'Sữa', label: ' ', unit: 'L' as const }],
    [{ name: 'Sữa', unit: 'ML' as const }],
    [{ name: 'Sữa', unit: 'L' as const }, { name: ' SỮA ', unit: 'KG' as const }],
    [{ name: 'a'.repeat(121), unit: 'KG' as const }],
    [{ name: 'Bột', unit: 'KG' as const, lowStockThreshold: '0.0001' }],
    [{ name: 'Bột', unit: 'KG' as const, lowStockThreshold: '-1' }],
    [{ name: 'Chai', unit: 'BOTTLE' as const, lowStockThreshold: '1.5' }],
  ]) expect(() => catalog.readIngredientCatalog(entries)).toThrow();
});

function stockRow(name: string, unit: 'PIECE' | 'L' = 'PIECE') {
  return { id: 'stock-id', name, normalizedName: name.toLocaleLowerCase('vi'), unit,
    quantity: new Prisma.Decimal('300'), lowStockThreshold: new Prisma.Decimal('10'), version: 7,
    createdBy: { id: 'actor-id', email: 'fixture@example.invalid' }, movements: [],
    createdAt: new Date('2026-10-30T00:00:00Z'), updatedAt: new Date('2026-10-30T00:00:00Z') };
}

test('removing, relabeling and restoring an entry changes listing without altering stock identity/history', async () => {
  const row = stockRow('Ly nhựa');
  const before = JSON.stringify(row);
  const db = { ingredient: { findMany: jest.fn().mockResolvedValue([row]) } };
  const service = new IngredientService(db as unknown as PrismaService);
  const definitions = catalog.readIngredientCatalog([{ name: 'Ly nhựa', label: 'Ly kèm nắp', unit: 'PIECE' }]);
  const config = jest.spyOn(catalog, 'readIngredientCatalog').mockReturnValue(definitions);
  expect((await service.ingredients()).items[0]).toMatchObject({ id: row.id, name: 'Ly nhựa', displayName: 'Ly kèm nắp', isListed: true, quantity: '300.000', version: 7 });
  config.mockReturnValue([]);
  expect((await service.ingredients()).items[0]).toMatchObject({ id: row.id, displayName: 'Ly nhựa', isListed: false, quantity: '300.000', version: 7 });
  config.mockReturnValue(definitions);
  expect((await service.ingredients()).items[0].isListed).toBe(true);
  expect(JSON.stringify(row)).toBe(before);
});

test('same name with a different unit is not offered as the configured item', async () => {
  const db = { ingredient: { findMany: jest.fn().mockResolvedValue([stockRow('Ly thủy tinh cao', 'L')]) } };
  const result = await new IngredientService(db as unknown as PrismaService).ingredients();
  expect(result.items[0].isListed).toBe(false);
});

test('initialization creates missing storage definitions at zero without persisting display labels', async () => {
  const definitions = catalog.readIngredientCatalog([{ name: 'Khăn giấy', label: 'Khăn giấy bàn', unit: 'PIECE' }]);
  jest.spyOn(catalog, 'readIngredientCatalog').mockReturnValue(definitions);
  const tx = { $executeRaw: jest.fn().mockResolvedValue(0), $queryRaw: jest.fn().mockResolvedValue([]),
    ingredient: { findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ normalizedName: 'khăn giấy', unit: 'PIECE' }]),
      createMany: jest.fn<Promise<{ count: number }>, [Prisma.IngredientCreateManyArgs]>().mockResolvedValue({ count: 1 }) } };
  const db = { $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
  expect(await new IngredientService(db as unknown as PrismaService).initializeCatalog('actor-id')).toEqual({ created: 1, existing: 0 });
  expect(tx.ingredient.createMany).toHaveBeenCalledWith({ skipDuplicates: true, data: [expect.objectContaining({ name: 'Khăn giấy', normalizedName: 'khăn giấy', unit: 'PIECE', createdById: 'actor-id' })] });
  const payload: unknown = tx.ingredient.createMany.mock.calls[0]?.[0];
  expect(payload).not.toHaveProperty('data.0.displayName');
  expect(payload).not.toHaveProperty('data.0.label');
  expect(payload).not.toHaveProperty('data.0.quantity');
});

test('empty catalog initialization is a no-op and unit conflicts never create or convert stock', async () => {
  const config = jest.spyOn(catalog, 'readIngredientCatalog').mockReturnValue([]);
  const tx = { $executeRaw: jest.fn().mockResolvedValue(0), $queryRaw: jest.fn().mockResolvedValue([]),
    ingredient: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() } };
  const db = { $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
  const service = new IngredientService(db as unknown as PrismaService);
  expect(await service.initializeCatalog('actor-id')).toEqual({ created: 0, existing: 0 });
  config.mockReturnValue([{ name: 'Sữa', normalizedName: 'sữa', unit: 'L', displayName: 'Sữa' }]);
  tx.ingredient.findMany.mockResolvedValue([{ normalizedName: 'sữa', unit: 'KG' }]);
  await expect(service.initializeCatalog('actor-id')).rejects.toMatchObject({ response: { code: 'INGREDIENT_UNIT_MISMATCH' } });
  expect(tx.ingredient.createMany).not.toHaveBeenCalled();
});

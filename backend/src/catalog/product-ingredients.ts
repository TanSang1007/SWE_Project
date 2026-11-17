import { ConflictException } from '@nestjs/common';
import { Prisma, type IngredientUnit } from '../generated/prisma/client';
import { hasToppingRecipe, normalizeRecipeName, recipeAmountKey, recipeCapacity, inventoryRecipeForDrink as recipeForDrink, recipeStorageName, sumRecipeAmounts, type DrinkSize, type RecipeAmount } from './drink-recipes';

type Requirement = { name: string; unit: IngredientUnit };
type Reader = Pick<Prisma.TransactionClient, 'ingredient'>;
export const productRecipe = (name: string): readonly Requirement[] | undefined => recipeForDrink(name, 'S')?.map(({ name: ingredient, unit }) => ({ name: ingredient, unit }));
export const ingredientKey = (item: Requirement) => `${normalizeRecipeName(item.name)}|${item.unit}`;
export const productIngredientKeys = (name: string) => productRecipe(name)?.map(item => 'i07:' + ingredientKey(item)) ?? [];

export async function ingredientBalances(db: Reader, keys: readonly string[]) {
  const identities = keys.map(key => {
    const current = key.startsWith('i07:');
    const [name, unit] = (current ? key.slice(4) : key).split('|');
    return { key, name: current ? normalizeRecipeName(recipeStorageName(name)) : name, unit };
  });
  const names = [...new Set(identities.map(item => item.name))];
  if (!names.length) return new Map<string, string>();
  const rows = await db.ingredient.findMany({ where: { normalizedName: { in: names } }, select: { normalizedName: true, unit: true, quantity: true, reservedQuantity: true } });
  const balances = new Map<string, string>();
  for (const item of identities) {
    const row = rows.find(candidate => candidate.normalizedName === item.name && candidate.unit === item.unit);
    if (row) balances.set(item.key, row.quantity.minus(row.reservedQuantity ?? 0).toFixed(3));
  }
  return balances;
}
export async function recipeBalances(db: Reader, amounts: readonly RecipeAmount[]) {
  const balances = await ingredientBalances(db, amounts.map(amount => 'i07:' + recipeAmountKey(amount)));
  return new Map([...balances].map(([key, value]) => [key.slice(4), value]));
}
export async function assertRecipeAmounts(db: Reader, amounts: readonly RecipeAmount[]) {
  const balances = await recipeBalances(db, amounts);
  const missing = amounts.filter(amount => new Prisma.Decimal(balances.get(recipeAmountKey(amount)) ?? 0).lt(amount.quantity)).map(amount => amount.name);
  if (missing.length) throw new ConflictException({ code: 'OUT_OF_STOCK', message: 'Không đủ nguyên liệu theo size và số lượng đã chọn.', details: { missingIngredients: missing } });
}
export async function configurationIngredientStates(db: Reader, items: readonly { name: string; size: string; toppings?: readonly string[] }[]) {
  const amounts = items.map(item => {
    if (!['S','M','L'].includes(item.size)) return undefined;
    const base = recipeForDrink(item.name, item.size as DrinkSize);
    return base && item.toppings?.some(topping => !hasToppingRecipe(topping)) ? [] : recipeForDrink(item.name, item.size as DrinkSize, item.toppings);
  });
  const balances = await recipeBalances(db, amounts.flatMap(item => item ?? []));
  return amounts.map(recipe => recipe ? recipeCapacity(recipe, balances) : undefined);
}
export async function productIngredientStates(db: Reader, names: readonly string[]) {
  const definitions = names.map(name => ({ name, amounts: recipeForDrink(name, 'S') }));
  const balances = await recipeBalances(db, names.flatMap(name => (['S','M','L'] as const).flatMap(size => recipeForDrink(name, size) ?? [])));
  return new Map(definitions.map(({ name, amounts }) => {
    if (!amounts) return [name, undefined] as const;
    const sizes = (['S', 'M', 'L'] as const).map(size => ({ size, ...recipeCapacity(recipeForDrink(name, size)!, balances) }));
    const ingredients = amounts.map(item => {
      const quantity = balances.get(recipeAmountKey(item)) ?? null;
      return { name: item.name, unit: item.unit, quantity, requiredQuantity: item.quantity, available: quantity !== null && new Prisma.Decimal(quantity).gte(item.quantity) };
    });
    return [name, { available: sizes.some(size => size.available), sizes, ingredients,
      missingIngredients: ingredients.filter(item => !item.available).map(item => item.name) }] as const;
  }));
}
// Compatibility for orders created before quantified I07 reservations existed.
export async function assertIngredientStock(tx: Prisma.TransactionClient, keys: readonly string[]) {
  const names = [...new Set(keys.map(key => key.startsWith('i07:') ? normalizeRecipeName(recipeStorageName(key.slice(4).split('|')[0])) : key.split('|')[0]))];
  if (!names.length) return;
  await tx.$queryRaw`SELECT id FROM ingredients WHERE normalized_name IN (${Prisma.join(names)}) ORDER BY id FOR SHARE`;
  const balances = await ingredientBalances(tx, keys);
  const missing = [...new Set(keys.filter(key => !new Prisma.Decimal(balances.get(key) ?? '0').gt(0)).map(key => key.split('|')[0]))];
  if (missing.length) throw new ConflictException({ code: 'OUT_OF_STOCK', message: 'Món hết nguyên liệu.', details: { missingIngredients: missing } });
}
export type RecipeSnapshot = { productId: string; qty: number; ingredientKeysSnapshot?: string[] };
export function productStockDemand(items: readonly RecipeSnapshot[]) {
  const demand = new Map<string, number>();
  for (const item of items) if (!item.ingredientKeysSnapshot?.length) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.qty);
  return [...demand].sort(([a], [b]) => a.localeCompare(b));
}
export { sumRecipeAmounts };

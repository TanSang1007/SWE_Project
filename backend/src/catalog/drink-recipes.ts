import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

export type DrinkSize = 'S' | 'M' | 'L';
export type RecipeAmount = { name: string; unit: 'KG' | 'L'; quantity: string };
type Dose = readonly [name: string, unit: 'g' | 'ml', amount: number, optional?: boolean];
type SizeRecipe = Record<DrinkSize, readonly Dose[]>;
export const normalizeRecipeName = (name: string) => name.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('vi');
export const recipeAmountKey = (item: Pick<RecipeAmount, 'name' | 'unit'>) => normalizeRecipeName(item.name) + '|' + item.unit;

// Restored I07 serving quantities for all seven drinks and S/M/L sizes.
// Grams and millilitres are converted exactly to the warehouse's kg and litres.
export const drinkRecipes: Readonly<Record<string, SizeRecipe>> = {
  cappuccino: {
    S: [['Cà phê hạt rang', 'g', 9], ['Nước lọc', 'ml', 25], ['Sữa tươi không đường', 'ml', 110], ['Bột cacao nguyên chất', 'g', 1]],
    M: [['Cà phê hạt rang', 'g', 18], ['Nước lọc', 'ml', 40], ['Sữa tươi không đường', 'ml', 160], ['Bột cacao nguyên chất', 'g', 2]],
    L: [['Cà phê hạt rang', 'g', 18], ['Nước lọc', 'ml', 40], ['Sữa tươi không đường', 'ml', 230], ['Bột cacao nguyên chất', 'g', 2]],
  },
  latte: {
    S: [['Cà phê hạt rang', 'g', 9], ['Nước lọc', 'ml', 25], ['Sữa tươi không đường', 'ml', 150], ['Syrup đường', 'ml', 5]],
    M: [['Cà phê hạt rang', 'g', 18], ['Nước lọc', 'ml', 40], ['Sữa tươi không đường', 'ml', 220], ['Syrup đường', 'ml', 10]],
    L: [['Cà phê hạt rang', 'g', 18], ['Nước lọc', 'ml', 40], ['Sữa tươi không đường', 'ml', 300], ['Syrup đường', 'ml', 15]],
  },
  'cold brew': {
    S: [['Cà phê xay thô Cold Brew', 'g', 20], ['Nước lọc', 'ml', 200], ['Đá viên', 'g', 100], ['Syrup đường', 'ml', 5, true]],
    M: [['Cà phê xay thô Cold Brew', 'g', 30], ['Nước lọc', 'ml', 300], ['Đá viên', 'g', 150], ['Syrup đường', 'ml', 10, true]],
    L: [['Cà phê xay thô Cold Brew', 'g', 40], ['Nước lọc', 'ml', 400], ['Đá viên', 'g', 200], ['Syrup đường', 'ml', 15, true]],
  },
  'đen đá': {
    S: [['Cà phê bột pha phin', 'g', 20], ['Nước lọc', 'ml', 80], ['Đường cát', 'g', 10], ['Đá viên', 'g', 100]],
    M: [['Cà phê bột pha phin', 'g', 25], ['Nước lọc', 'ml', 100], ['Đường cát', 'g', 15], ['Đá viên', 'g', 150]],
    L: [['Cà phê bột pha phin', 'g', 35], ['Nước lọc', 'ml', 140], ['Đường cát', 'g', 20], ['Đá viên', 'g', 200]],
  },
  'asian dolce latte': {
    S: [['Cà phê hạt rang', 'g', 9], ['Nước lọc', 'ml', 25], ['Sữa tươi không đường', 'ml', 130], ['Sữa đặc', 'g', 25], ['Đá viên', 'g', 100]],
    M: [['Cà phê hạt rang', 'g', 18], ['Nước lọc', 'ml', 40], ['Sữa tươi không đường', 'ml', 180], ['Sữa đặc', 'g', 35], ['Đá viên', 'g', 130]],
    L: [['Cà phê hạt rang', 'g', 18], ['Nước lọc', 'ml', 40], ['Sữa tươi không đường', 'ml', 260], ['Sữa đặc', 'g', 45], ['Đá viên', 'g', 180]],
  },
  'matcha coldwhisk': {
    S: [['Bột matcha', 'g', 3], ['Nước lọc', 'ml', 30], ['Sữa tươi không đường', 'ml', 150], ['Syrup đường', 'ml', 15], ['Đá viên', 'g', 100]],
    M: [['Bột matcha', 'g', 5], ['Nước lọc', 'ml', 50], ['Sữa tươi không đường', 'ml', 200], ['Syrup đường', 'ml', 20], ['Đá viên', 'g', 150]],
    L: [['Bột matcha', 'g', 7], ['Nước lọc', 'ml', 60], ['Sữa tươi không đường', 'ml', 270], ['Syrup đường', 'ml', 25], ['Đá viên', 'g', 200]],
  },
  'cacao đá': {
    S: [['Bột cacao nguyên chất', 'g', 15], ['Nước lọc', 'ml', 40], ['Sữa tươi không đường', 'ml', 130], ['Sữa đặc', 'g', 20], ['Đá viên', 'g', 100]],
    M: [['Bột cacao nguyên chất', 'g', 20], ['Nước lọc', 'ml', 50], ['Sữa tươi không đường', 'ml', 180], ['Sữa đặc', 'g', 25], ['Đá viên', 'g', 150]],
    L: [['Bột cacao nguyên chất', 'g', 28], ['Nước lọc', 'ml', 65], ['Sữa tươi không đường', 'ml', 250], ['Sữa đặc', 'g', 35], ['Đá viên', 'g', 200]],
  },
};
const aliases: Readonly<Record<string, string>> = { cappuchino: 'cappuccino', 'matcha coldwisk': 'matcha coldwhisk', 'ca cao đá': 'cacao đá' };
const toppingRecipes: Readonly<Record<string, { name: string; doses: Record<DrinkSize, number> }>> = {
  kem: { name: 'Kem tươi', doses: { S: 20, M: 30, L: 40 } },
  'kem tươi': { name: 'Kem tươi', doses: { S: 20, M: 30, L: 40 } },
  caramel: { name: 'Syrup caramel', doses: { S: 10, M: 15, L: 20 } },
  'syrup caramel': { name: 'Syrup caramel', doses: { S: 10, M: 15, L: 20 } },
};
export const hasToppingRecipe = (name: string) => Object.hasOwn(toppingRecipes, normalizeRecipeName(name));
export function recipeForDrink(name: string, size: DrinkSize, toppings: readonly string[] = [], includeOptionalSyrup = true): RecipeAmount[] | undefined {
  const key = normalizeRecipeName(name), canonical = Object.hasOwn(aliases, key) ? aliases[key] : key;
  if (!Object.hasOwn(drinkRecipes, canonical)) return undefined;
  const doses = drinkRecipes[canonical][size].filter(dose => !dose[3] || includeOptionalSyrup);
  const amounts: RecipeAmount[] = doses.map(([ingredient, unit, amount]) => ({
    name: ingredient, unit: unit === 'g' ? 'KG' : 'L', quantity: new Prisma.Decimal(amount).dividedBy(1000).toFixed(3),
  }));
  for (const topping of toppings) {
    const toppingKey = normalizeRecipeName(topping);
    if (Object.hasOwn(toppingRecipes, toppingKey)) {
      const item = toppingRecipes[toppingKey];
      amounts.push({ name: item.name, unit: 'L', quantity: new Prisma.Decimal(item.doses[size]).dividedBy(1000).toFixed(3) });
    } else throw new ConflictException({ code: 'OUT_OF_STOCK', message: 'Topping chưa có định lượng nguyên liệu để bán.' });
  }
  return amounts;
}

// Water remains in the supplied preparation recipe. Only managed materials
// participate in new stock checks, reservations and consumption (I08).
export function inventoryRecipeForDrink(name: string, size: DrinkSize, toppings: readonly string[] = []) {
  return recipeForDrink(name, size, toppings)?.filter(amount => normalizeRecipeName(amount.name) !== 'nước lọc');
}

// Keep the new stock separate from every previous catalog identity/history.
export const recipeStorageName = (name: string) => name + ' (công thức)';

export function sumRecipeAmounts(items: readonly { amounts: readonly RecipeAmount[]; qty: number }[]): RecipeAmount[] {
  const totals = new Map<string, RecipeAmount>();
  for (const { amounts, qty } of items) for (const amount of amounts) {
    const key = recipeAmountKey(amount), current = totals.get(key);
    totals.set(key, { ...amount, quantity: new Prisma.Decimal(current?.quantity ?? 0).plus(new Prisma.Decimal(amount.quantity).times(qty)).toFixed(3) });
  }
  return [...totals.values()].sort((a, b) => recipeAmountKey(a).localeCompare(recipeAmountKey(b)));
}

export function recipeCapacity(amounts: readonly RecipeAmount[], availableBalances: ReadonlyMap<string, string>) {
  const totals = sumRecipeAmounts([{ amounts, qty: 1 }]);
  const cups = totals.length ? totals.reduce((least, amount) => {
    const available = new Prisma.Decimal(availableBalances.get(recipeAmountKey(amount)) ?? 0);
    const possible = available.dividedBy(amount.quantity).floor().toNumber();
    return Math.min(least, Math.max(0, possible));
  }, Number.MAX_SAFE_INTEGER) : 0;
  return { cups, available: cups > 0, status: cups === 0 ? 'OUT_OF_STOCK' as const : cups <= 10 ? 'LOW_STOCK' as const : 'IN_STOCK' as const };
}

import { Prisma } from '../src/generated/prisma/client';
import { productIngredientKeys, productIngredientStates, productRecipe, productStockDemand } from '../src/catalog/product-ingredients';
import { inventoryRecipeForDrink as recipeForDrink, recipeStorageName } from '../src/catalog/drink-recipes';

const names = ['Cappuccino', 'Latte', 'Cold brew', 'Đen đá', 'Asian Dolce Latte', 'Matcha Coldwisk', 'Cacao đá'];
test.each(names)('%s requires a complete serving rather than merely a positive balance', async name => {
  const recipe = productRecipe(name)!;
  const amounts = recipeForDrink(name,'S')!;
  const rows = recipe.map((i,index) => ({ normalizedName: recipeStorageName(i.name).toLocaleLowerCase('vi'), unit: i.unit, quantity: new Prisma.Decimal(amounts[index].quantity), reservedQuantity: new Prisma.Decimal(0) }));
  const db = { ingredient: { findMany: jest.fn().mockResolvedValue(rows) } };
  const read = () => productIngredientStates(db as never, [name]);
  expect((await read()).get(name)?.available).toBe(true);
  for (const row of rows) {
    row.quantity = new Prisma.Decimal(0);
    expect((await read()).get(name)).toMatchObject({ available: false, missingIngredients: [recipe[rows.indexOf(row)].name] });
    row.quantity = new Prisma.Decimal(amounts[rows.indexOf(row)].quantity);
  }
  db.ingredient.findMany.mockResolvedValue(rows.slice(1));
  expect((await read()).get(name)?.available).toBe(false);
  db.ingredient.findMany.mockResolvedValue(rows.map(r => ({ ...r, unit: 'ML' })));
  expect((await read()).get(name)?.available).toBe(false);
});
test('aliases match user names; unrelated products retain legacy inventory without ingredient queries', async () => {
  expect(productIngredientKeys('  Cappuchino ')).toEqual(productIngredientKeys('Cappuccino'));
  expect(productIngredientKeys('Ca cao đá')).toEqual(productIngredientKeys('Cacao đá'));
  expect(productRecipe('constructor')).toBeUndefined();
  const db = { ingredient: { findMany: jest.fn() } };
  expect((await productIngredientStates(db as never, ['Fixture drink'])).get('Fixture drink')).toBeUndefined();
  expect(db.ingredient.findMany).not.toHaveBeenCalled();
});
test('stock restoration follows immutable order snapshots, including mixed old/new items', () => {
  expect(productStockDemand([{ productId: 'p', qty: 2, ingredientKeysSnapshot: [] },
    { productId: 'p', qty: 3, ingredientKeysSnapshot: ['cà phê|KG'] }, { productId: 'p', qty: 4 }])).toEqual([['p', 6]]);
});

import { Prisma } from '../src/generated/prisma/client';
import { recipeForProduct, type RecipeProduct } from '../src/catalog/product-recipes';
import { productIngredientStates } from '../src/catalog/product-ingredients';
import { inventoryRecipeForDrink } from '../src/catalog/drink-recipes';

const product: RecipeProduct = { id: 'BR100', name: 'Latte', hasCustomRecipe: true, recipeIngredients: [
  { size: 'M', quantity: new Prisma.Decimal('0.125'), ingredient: { name: 'Sữa tươi không đường (công thức)', unit: 'L' } },
  { size: 'M', quantity: new Prisma.Decimal('0.010'), ingredient: { name: 'Đường cát (công thức)', unit: 'KG' } },
] };
test('product ID recipe overrides a matching supplied name and survives renaming', () => {
  const expected = [{ name: 'Sữa tươi không đường', unit: 'L', quantity: '0.125' }, { name: 'Đường cát', unit: 'KG', quantity: '0.010' }];
  expect(recipeForProduct(product, 'M')).toEqual(expected);
  expect(recipeForProduct({ ...product, name: 'New name' }, 'M')).toEqual(expected);
  expect(recipeForProduct(product, 'M', ['Kem'])).toEqual([...expected, { name: 'Kem tươi', unit: 'L', quantity: '0.030' }]);
});
test('missing custom sizes/recipes never fall back to code; original products keep their recipes', () => {
  expect(recipeForProduct(product, 'S')).toBeUndefined();
  expect(recipeForProduct({ ...product, recipeIngredients: [] }, 'M')).toBeUndefined();
  expect(recipeForProduct({ id: 'old', name: 'Latte', hasCustomRecipe: false }, 'S')).toEqual(inventoryRecipeForDrink('Latte', 'S'));
});
test('a recipe configured only for M works independently, using available balances after reservations', async () => {
  const db = { ingredient: { findMany: jest.fn().mockResolvedValue([
    { normalizedName: 'sữa tươi không đường (công thức)', unit: 'L', quantity: new Prisma.Decimal('0.375'), reservedQuantity: new Prisma.Decimal('0.125') },
    { normalizedName: 'đường cát (công thức)', unit: 'KG', quantity: new Prisma.Decimal('1'), reservedQuantity: new Prisma.Decimal('0') },
  ]) } };
  const state = (await productIngredientStates(db as never, [product])).get(product.id);
  expect(state).toMatchObject({ available: true, sizes: [{ size: 'S', cups: 0 }, { size: 'M', cups: 2 }, { size: 'L', cups: 0 }] });
});

import { Prisma, type IngredientUnit } from '../generated/prisma/client';
import { readIngredientCatalog } from '../ingredients/ingredient-catalog';
import { inventoryRecipeForDrink, toppingRecipeAmounts, type DrinkSize, type RecipeAmount } from './drink-recipes';

// Fetch with each product so list/cart/pricing use the same ID-bound recipe without N+1 reads.
export const recipeIngredientSelect = {
  size: true, quantity: true,
  ingredient: { select: { name: true, unit: true } },
} satisfies Prisma.ProductRecipeIngredientSelect;
export type RecipeProduct = {
  id: string; name: string; hasCustomRecipe?: boolean;
  recipeIngredients?: readonly { size: string; quantity: Prisma.Decimal; ingredient: { name: string; unit: IngredientUnit } }[];
};
export const recipeMaterials = () => readIngredientCatalog().filter(item => item.unit === 'KG' || item.unit === 'L');

// Existing seven drinks keep their supplied code recipes. New custom recipes take
// precedence even for a matching name; missing custom sizes always remain unavailable.
export function recipeForProduct(product: string | RecipeProduct, size: DrinkSize, toppings: readonly string[] = []): RecipeAmount[] | undefined {
  if (typeof product === 'string' || !product.hasCustomRecipe) {
    return inventoryRecipeForDrink(typeof product === 'string' ? product : product.name, size, toppings);
  }
  const lines = product.recipeIngredients?.filter(line => line.size === size);
  if (!lines?.length || lines.some(line => !['KG', 'L'].includes(line.ingredient.unit) || !line.quantity.gt(0))) return undefined;
  return [...lines.map(line => ({
    name: line.ingredient.name.replace(/ \(công thức\)$/, ''),
    unit: line.ingredient.unit as 'KG' | 'L', quantity: line.quantity.toFixed(3),
  })), ...toppingRecipeAmounts(size, toppings)];
}

export interface AdminProduct {
  id: string; name: string; price: string; imageUrl: string; stock: number; isActive: boolean; version: number;
  createdAt: string; updatedAt: string;
  available?: boolean; recipeConfigured?: boolean; availableSizes?: string[];
  sizes: { size: 'S' | 'M' | 'L'; extraPrice: string }[];
  toppings: { id: string; name: string; price: string; createdAt: string; updatedAt: string }[];
}
export interface ProductCreate {
  name: string; price: string; imageUrl: string;
  sizes: { size: 'S' | 'M' | 'L'; extraPrice: string; recipe: ProductRecipeLine[]; waterMl: string }[];
  toppingIds: string[];
}
export type ProductRecipeLine = { ingredientId: string; amount: string; unit: 'g' | 'ml' };
export type RecipeIngredientOption = { id: string; name: string; unit: 'g' | 'ml' };
export interface ProductUpdate {
  expectedVersion: number; name?: string; price?: string; imageUrl?: string; isActive?: boolean;
}

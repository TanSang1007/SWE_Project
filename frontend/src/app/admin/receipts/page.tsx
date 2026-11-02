import { IngredientInventory } from '../../../components/ingredient-inventory';
export default async function ReceiptsPage({searchParams}:{searchParams:Promise<{category?:string}>}) {
  const {category}=await searchParams;
  return <IngredientInventory view="receiving" initialCategory={category==='materials'?'materials':'supplies'}/>;
}

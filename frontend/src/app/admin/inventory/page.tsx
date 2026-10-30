import { redirect } from 'next/navigation';
import { IngredientInventory } from '../../../components/ingredient-inventory';
export default async function InventoryPage({searchParams}:{searchParams:Promise<{category?:string;productId?:string}>}) {
  const query=await searchParams;
  if(query.productId)redirect('/admin/products/inventory?productId='+encodeURIComponent(query.productId));
  return <IngredientInventory view="stock" initialCategory={query.category==='materials'?'materials':'supplies'}/>;
}

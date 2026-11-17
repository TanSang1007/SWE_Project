import { redirect } from 'next/navigation';
// Old bookmarks lead to products; drink stock is determined by recipe ingredients.
export default function ProductInventoryPage(){redirect('/admin/products');}

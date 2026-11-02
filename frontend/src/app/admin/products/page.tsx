import { AdminProducts } from '../../../components/admin-products';
import Link from 'next/link';
export default function AdminProductsPage() { return <><Link className="button secondary" href="/admin/products/inventory">Tồn sản phẩm</Link><AdminProducts /></>; }

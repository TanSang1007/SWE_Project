import { AdminProductOptions } from '../../../../../components/admin-options';
export default async function ProductOptionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <AdminProductOptions id={id.toLowerCase()} />;
}

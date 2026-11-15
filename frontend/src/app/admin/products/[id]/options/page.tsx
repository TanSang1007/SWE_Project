import { AdminProductOptions } from '../../../../../components/admin-options';
export default async function ProductOptionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const normalizedId = /^br\d+$/i.test(id.trim()) ? id.trim().toUpperCase() : id.trim();
  return <AdminProductOptions id={normalizedId} />;
}

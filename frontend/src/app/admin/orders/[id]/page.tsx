import { OperatorOrdersView } from '../../../../components/operator-orders-view';
export default async function AdminOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <OperatorOrdersView area="admin" id={id} />;
}

import { OperatorOrdersView } from '../../../../components/operator-orders-view';
export default async function OperatorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OperatorOrdersView id={id} />;
}

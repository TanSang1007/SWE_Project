import { OrderHistoryView } from '../../../../components/order-history-view';
export default async function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <OrderHistoryView id={id} />;
}

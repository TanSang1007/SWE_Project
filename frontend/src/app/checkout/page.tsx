import { CheckoutView } from '../../components/checkout-view';
import { validOrderId } from '../../lib/order-display';
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ orderId?: string | string[] }> }) {
  const { orderId } = await searchParams;
  return <CheckoutView orderId={typeof orderId === 'string' && validOrderId(orderId) ? orderId : undefined} />;
}

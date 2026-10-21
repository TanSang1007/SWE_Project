import { CartView } from '../../components/cart-view';
import { validOrderId } from '../../lib/order-display';
export default async function CartPage({ searchParams }: { searchParams: Promise<{ orderId?: string | string[] }> }) {
  const { orderId } = await searchParams;
  return <CartView orderId={typeof orderId === 'string' && validOrderId(orderId) ? orderId : undefined} />;
}

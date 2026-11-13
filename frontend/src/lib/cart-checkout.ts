import { CartError } from './api/cart';
import { OrderError } from './api/orders';
import { previewOrder } from './api/loyalty-redemption';
import { useAuthStore } from './auth-store';
import { useCartStore } from './cart-store';
// No order/reservation is created here. Order creation still validates again.
export async function prepareCartCheckout(hasActiveOrder: () => Promise<boolean>): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const assertSession = () => {
    if (!token || useAuthStore.getState().accessToken !== token) throw new OrderError('UNAUTHORIZED');
  };
  assertSession();
  await useCartStore.getState().flush(); assertSession();
  if (await hasActiveOrder()) throw new OrderError('INVALID_ORDER_STATE');
  assertSession();
  const before = useCartStore.getState().cart;
  if (!await useCartStore.getState().load()) throw new OrderError('CONCURRENT_UPDATE');
  assertSession();
  const cart = useCartStore.getState().cart;
  if (!cart?.items.length) throw new CartError('EMPTY_CART');
  const quote = await previewOrder({ items: cart.items.map(item => ({
    productId: item.productId, size: item.size, toppingIds: item.toppings.map(t => t.id), qty: item.qty,
  })) });
  assertSession();
  if (useCartStore.getState().saving || useCartStore.getState().cart !== cart) throw new OrderError('CONCURRENT_UPDATE');
  // Catch changed contents even when two different carts have the same subtotal.
  const signature = (value: typeof cart | null) => JSON.stringify(value?.items.map(item => [
    item.id, item.qty, item.size, item.toppings.map(t => t.id), item.unitPrice,
  ]));
  if (quote.itemSubtotal !== cart.subtotal || signature(before) !== signature(cart)) throw new CartError('CART_CHANGED');
}

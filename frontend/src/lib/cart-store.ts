'use client';
import { create } from 'zustand';
import { CartError, cartRequest } from './api/cart';
import { useAuthStore } from './auth-store';
import type { Cart } from '../types/cart';
interface State {
  cart: Cart | null;
  saving: boolean;
  syncError: unknown;
  setCart: (cart: Cart) => void;
  load: () => Promise<boolean>;
  changeQuantity: (id: string, qty: number) => void;
  flush: () => Promise<void>;
  cancelPending: () => void;
}
const SAVE_DELAY = 400;
let revision = 0, session = 0, editVersion = 0;
let confirmed: Cart | null = null;
const pending = new Map<string, { qty: number; version: number }>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
function stopTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
// Prices are estimates until the server acknowledges the saved cart.
function overlay(cart: Cart): Cart {
  const items = cart.items.map(item => ({ ...item, qty: pending.get(item.id)?.qty ?? item.qty }));
  const demand = new Map<string, number>();
  for (const item of items) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.qty);
  for (const item of items) {
    item.lineTotal = (BigInt(item.unitPrice) * BigInt(item.qty)).toString();
    item.requestedQuantity = demand.get(item.productId)!;
  }
  return { ...cart, items, totalQuantity: items.reduce((sum, item) => sum + item.qty, 0),
    subtotal: items.reduce((sum, item) => sum + BigInt(item.lineTotal), 0n).toString() };
}
function publish(cart: Cart) {
  confirmed = cart;
  // A row removed/merged elsewhere must not silently drop an unsaved change.
  if ([...pending.keys()].some(id => !cart.items.some(item => item.id === id))) {
    throw new CartError('CART_CHANGED');
  }
  const visible = pending.size ? overlay(cart) : cart;
  if (BigInt(visible.subtotal) > 999999999999n) throw new CartError('VALIDATION_ERROR');
  useCartStore.setState({ cart: visible });
}
async function flush(): Promise<void> {
  stopTimer();
  if (running) { await running; if (pending.size) return flush(); return; }
  if (!pending.size) {
    if (useCartStore.getState().syncError) throw useCartStore.getState().syncError;
    return;
  }
  const epoch = session, token = useAuthStore.getState().accessToken;
  const current = () => epoch === session && useAuthStore.getState().accessToken === token;
  // Assign the promise before starting work; one request at a time across routes.
  const work = Promise.resolve().then(async () => {
    try {
      while (current() && pending.size) {
        const [id, change] = pending.entries().next().value!;
        const result = await cartRequest('PATCH', `/cart/items/${id}`, { qty: change.qty });
        if (!current()) return;
        if (pending.get(id)?.version === change.version) pending.delete(id);
        revision++;
        publish(result);
      }
    } catch (error) {
      if (current()) {
        pending.clear(); stopTimer(); revision++;
        useCartStore.setState({ cart: confirmed, syncError: error });
        // A timeout can mean the write committed. Read the authoritative cart;
        // retain the error until explicit reload so checkout never assumes success.
        try {
          const actual = await cartRequest();
          if (current()) { revision++; publish(actual); }
        } catch { /* Keep the last acknowledged cart and block checkout. */ }
      }
      throw error;
    }
  });
  running = work;
  try { await work; }
  finally {
    if (running === work) running = null;
    if (current()) useCartStore.setState({ saving: pending.size > 0 });
  }
}
export const useCartStore = create<State>(() => ({
  cart: null, saving: false, syncError: null,
  setCart: cart => { revision++; publish(cart); },
  changeQuantity: (id, qty) => {
    const state = useCartStore.getState();
    if (!useAuthStore.getState().accessToken || !state.cart || state.syncError) return;
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return;
    const item = state.cart.items.find(item => item.id === id);
    if (!item || !item.available || item.qty === qty) return;
    pending.set(id, { qty, version: ++editVersion }); revision++;
    const draft = overlay(confirmed ?? state.cart);
    if (BigInt(draft.subtotal) > 999999999999n) {
      stopTimer(); pending.clear();
      useCartStore.setState({cart: confirmed, saving: !!running, syncError: new CartError('VALIDATION_ERROR')});
      return;
    }
    useCartStore.setState({ cart: draft, saving: true });
    stopTimer(); timer = setTimeout(() => { void flush().catch(() => {}); }, SAVE_DELAY);
  },
  flush,
  cancelPending: () => {
    stopTimer(); pending.clear(); revision++;
    useCartStore.setState({ cart: confirmed, saving: !!running });
  },
  load: async () => {
    // Explicit reload recovers a failed save; normal reads cannot overwrite edits.
    if (pending.size || running) await flush();
    const requestRevision = ++revision, epoch = session;
    const token = useAuthStore.getState().accessToken;
    const cart = await cartRequest();
    const committed = epoch === session && useAuthStore.getState().accessToken === token && requestRevision === revision;
    if (committed) { publish(cart); useCartStore.setState({ syncError: null }); }
    return committed;
  },
}));
useAuthStore.subscribe((state, previous) => {
  if (state.accessToken !== previous.accessToken || state.user?.id !== previous.user?.id || state.user?.role !== previous.user?.role) {
    session++; revision++; stopTimer(); pending.clear(); confirmed = null; running = null;
    useCartStore.setState({ cart: null, saving: false, syncError: null });
    if (state.accessToken && state.user?.role === 'CUSTOMER') void useCartStore.getState().load().catch(() => {});
  }
});

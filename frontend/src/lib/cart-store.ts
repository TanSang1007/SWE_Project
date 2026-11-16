'use client';
import { create } from 'zustand';
import { cartRequest } from './api/cart';
import { useAuthStore } from './auth-store';
import type { Cart } from '../types/cart';
interface State { cart: Cart | null; setCart: (cart: Cart) => void; load: () => Promise<boolean>; }
let revision = 0;
export const useCartStore = create<State>((set) => ({ cart: null, setCart: (cart) => { revision++; set({ cart }); },
  load: async () => {
    const requestRevision = ++revision;
    const token = useAuthStore.getState().accessToken;
    const cart = await cartRequest();
    const committed = useAuthStore.getState().accessToken === token && requestRevision === revision;
    if (committed) set({ cart });
    return committed;
  },
}));
useAuthStore.subscribe((state, previous) => {
  if (state.accessToken !== previous.accessToken || state.user?.id !== previous.user?.id || state.user?.role !== previous.user?.role) {
    revision++;
    useCartStore.setState({ cart: null });
    if (state.accessToken && state.user?.role === 'CUSTOMER') void useCartStore.getState().load().catch(() => {});
  }
});

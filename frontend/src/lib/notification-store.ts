'use client';
import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

export interface CenterPopupAction {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface CenterPopup {
  id: string;
  tone: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  orderCode?: string;
  total?: string;
  actions?: CenterPopupAction[];
}

interface NotificationState {
  toasts: ToastItem[];
  popup: CenterPopup | null;
  pushToast: (toast: Omit<ToastItem, 'id'>, durationMs?: number) => void;
  dismissToast: (id: string) => void;
  showPopup: (popup: Omit<CenterPopup, 'id'>) => void;
  closePopup: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  toasts: [],
  popup: null,
  pushToast: (toast, durationMs = 3500) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({
      toasts: [...state.toasts.slice(-3), { ...toast, id }],
    }));
    if (durationMs > 0 && typeof window !== 'undefined') {
      window.setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, durationMs);
    }
  },
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
  showPopup: (popup) =>
    set({
      popup: { ...popup, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    }),
  closePopup: () => set({ popup: null }),
}));

export function notifyToast(title: string, tone: ToastTone = 'success', message?: string, durationMs = 3500) {
  useNotificationStore.getState().pushToast({ title, tone, message }, durationMs);
}

export function notifyCenterPopup(popup: Omit<CenterPopup, 'id'>) {
  useNotificationStore.getState().showPopup(popup);
}

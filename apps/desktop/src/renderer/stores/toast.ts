import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, 0 = persistent
}

interface ToastStore {
  toasts: ToastItem[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;
const timerMap = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (type, message, duration = 5000) => {
    const id = `toast_${++nextId}`;
    set((s) => ({ toasts: [...s.toasts, { id, type, message, duration }] }));

    if (duration > 0) {
      const timer = setTimeout(() => {
        timerMap.delete(id);
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
      timerMap.set(id, timer);
    }
  },

  removeToast: (id) => {
    const timer = timerMap.get(id);
    if (timer) {
      clearTimeout(timer);
      timerMap.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

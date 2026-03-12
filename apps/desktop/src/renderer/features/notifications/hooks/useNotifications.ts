import { create } from 'zustand';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  source: string;
  read: boolean;
  createdAt: number;
}

interface NotificationStore {
  notifications: AppNotification[];
  unreadCount: number;

  addNotification: (n: Omit<AppNotification, 'id' | 'read' | 'createdAt'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

let counter = 0;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,

  addNotification: (n) => {
    const notification: AppNotification = {
      ...n,
      id: `notif_${++counter}`,
      read: false,
      createdAt: Date.now(),
    };
    set((s) => ({
      notifications: [notification, ...s.notifications].slice(0, 100),
      unreadCount: s.unreadCount + 1,
    }));
  },

  markRead: (id) => {
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
      unreadCount: Math.max(0, s.unreadCount - (s.notifications.find((n) => n.id === id && !n.read) ? 1 : 0)),
    }));
  },

  markAllRead: () => {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  clear: () => set({ notifications: [], unreadCount: 0 }),
}));

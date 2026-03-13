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
  loaded: boolean;

  loadNotifications: () => Promise<void>;
  addNotification: (n: Omit<AppNotification, 'id' | 'read' | 'createdAt'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

let counter = 0;

function persist(notifications: AppNotification[]): void {
  // Keep at most 100 notifications persisted
  const data = JSON.stringify(notifications.slice(0, 100));
  window.jowork.settings.set('notifications', data).catch(() => {});
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loaded: false,

  loadNotifications: async () => {
    if (get().loaded) return;
    try {
      const raw = await window.jowork.settings.get('notifications');
      if (raw) {
        const parsed: AppNotification[] = JSON.parse(raw);
        const unread = parsed.filter((n) => !n.read).length;
        // Restore counter to avoid ID collisions
        counter = parsed.reduce((max, n) => {
          const match = n.id.match(/notif_(\d+)/);
          return match ? Math.max(max, Number(match[1])) : max;
        }, counter);
        set({ notifications: parsed, unreadCount: unread, loaded: true });
        return;
      }
    } catch {
      // Corrupted data — start fresh
    }
    set({ loaded: true });
  },

  addNotification: (n) => {
    const notification: AppNotification = {
      ...n,
      id: `notif_${++counter}`,
      read: false,
      createdAt: Date.now(),
    };
    const updated = [notification, ...get().notifications].slice(0, 100);
    set({
      notifications: updated,
      unreadCount: get().unreadCount + 1,
    });
    persist(updated);
  },

  markRead: (id) => {
    const { notifications } = get();
    const target = notifications.find((n) => n.id === id && !n.read);
    const updated = notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n,
    );
    set({
      notifications: updated,
      unreadCount: Math.max(0, get().unreadCount - (target ? 1 : 0)),
    });
    persist(updated);
  },

  markAllRead: () => {
    const updated = get().notifications.map((n) => ({ ...n, read: true }));
    set({ notifications: updated, unreadCount: 0 });
    persist(updated);
  },

  clear: () => {
    set({ notifications: [], unreadCount: 0 });
    persist([]);
  },
}));

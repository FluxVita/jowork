import { create } from 'zustand';

interface LauncherStore {
  query: string;
  isStreaming: boolean;
  response: string;
  recentQueries: string[];

  setQuery: (q: string) => void;
  submit: () => Promise<void>;
  clear: () => void;
}

export const useLauncherStore = create<LauncherStore>((set, get) => ({
  query: '',
  isStreaming: false,
  response: '',
  recentQueries: [],

  setQuery: (q) => set({ query: q }),

  submit: async () => {
    const { query } = get();
    if (!query.trim()) return;

    set({ isStreaming: true, response: '' });

    // Add to recents
    set((s) => ({
      recentQueries: [query, ...s.recentQueries.filter((q2) => q2 !== query)].slice(0, 5),
    }));

    // Listen for streaming events
    const unsub = window.jowork.on('chat:event', (...args: unknown[]) => {
      const event = args[0] as { type: string; content?: string };
      if (event.type === 'text' && event.content) {
        set((s) => ({ response: s.response + event.content }));
      }
      if (event.type === 'result' || event.type === 'error') {
        set({ isStreaming: false });
        unsub();
      }
    });

    try {
      await window.jowork.chat.send({ message: query });
    } catch {
      set({ isStreaming: false });
      unsub();
    }

    set({ query: '' });
  },

  clear: () => set({ query: '', response: '', isStreaming: false }),
}));

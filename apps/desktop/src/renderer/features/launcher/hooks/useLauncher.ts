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

let _activeUnsub: (() => void) | null = null;

export const useLauncherStore = create<LauncherStore>((set, get) => ({
  query: '',
  isStreaming: false,
  response: '',
  recentQueries: [],

  setQuery: (q) => set({ query: q }),

  submit: async () => {
    const { query } = get();
    if (!query.trim()) return;

    // Tear down any previous listener to prevent accumulation
    _activeUnsub?.();
    _activeUnsub = null;

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
        _activeUnsub = null;
      }
    });
    _activeUnsub = unsub;

    try {
      await window.jowork.chat.send({ message: query });
    } catch {
      set({ isStreaming: false });
      unsub();
      _activeUnsub = null;
    }

    set({ query: '' });
  },

  clear: () => {
    _activeUnsub?.();
    _activeUnsub = null;
    set({ query: '', response: '', isStreaming: false });
  },
}));

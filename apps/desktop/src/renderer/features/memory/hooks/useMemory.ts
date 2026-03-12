import { create } from 'zustand';

export interface MemoryRecord {
  id: string;
  title: string;
  content: string;
  tags: string[];
  scope: string;
  pinned: boolean;
  source: string;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewMemory {
  title: string;
  content: string;
  tags?: string[];
  scope?: 'personal' | 'team';
  pinned?: boolean;
  source?: 'user' | 'auto';
}

interface MemoryStore {
  memories: MemoryRecord[];
  isLoading: boolean;
  searchQuery: string;

  loadMemories: (opts?: { scope?: string; pinned?: boolean }) => Promise<void>;
  search: (query: string) => Promise<void>;
  create: (mem: NewMemory) => Promise<MemoryRecord>;
  update: (id: string, patch: Partial<NewMemory>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  togglePin: (id: string, pinned: boolean) => Promise<void>;
  setSearchQuery: (q: string) => void;
}

export const useMemoryStore = create<MemoryStore>((set, get) => ({
  memories: [],
  isLoading: false,
  searchQuery: '',

  loadMemories: async (opts) => {
    set({ isLoading: true });
    try {
      const memories = await window.jowork.invoke('memory:list', opts ?? {});
      set({ memories: memories as MemoryRecord[], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  search: async (query) => {
    set({ isLoading: true, searchQuery: query });
    try {
      if (!query.trim()) {
        await get().loadMemories();
        return;
      }
      const memories = await window.jowork.invoke('memory:search', query);
      set({ memories: memories as MemoryRecord[], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  create: async (mem) => {
    const record = await window.jowork.invoke('memory:create', mem) as MemoryRecord;
    set((s) => ({ memories: [record, ...s.memories] }));
    return record;
  },

  update: async (id, patch) => {
    const updated = await window.jowork.invoke('memory:update', id, patch) as MemoryRecord;
    set((s) => ({
      memories: s.memories.map((m) => (m.id === id ? updated : m)),
    }));
  },

  remove: async (id) => {
    await window.jowork.invoke('memory:delete', id);
    set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }));
  },

  togglePin: async (id, pinned) => {
    await get().update(id, { pinned });
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
}));

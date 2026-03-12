import { create } from 'zustand';

interface ConnectorInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  tier: string;
  status: 'connected' | 'disconnected' | 'error';
  hasCredential: boolean;
}

interface HealthStatus {
  connectorId: string;
  status: 'healthy' | 'unhealthy' | 'stopped';
  lastCheck: number;
  error?: string;
}

interface ConnectorStore {
  connectors: ConnectorInfo[];
  health: Record<string, HealthStatus>;
  isLoading: boolean;

  loadConnectors: () => Promise<void>;
  connect: (id: string, credential?: Record<string, string>) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  checkHealth: () => Promise<void>;
}

export const useConnectorStore = create<ConnectorStore>((set) => ({
  connectors: [],
  health: {},
  isLoading: false,

  loadConnectors: async () => {
    set({ isLoading: true });
    try {
      const manifests = await window.jowork.connector.list();
      set({ connectors: manifests as ConnectorInfo[], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  connect: async (id, credential) => {
    try {
      if (credential) {
        await window.jowork.connector.saveCredential(id, credential);
      }
      await window.jowork.connector.start(id);
      set((s) => ({
        connectors: s.connectors.map((c) =>
          c.id === id ? { ...c, status: 'connected' as const, hasCredential: true } : c,
        ),
      }));
    } catch (err) {
      console.error('Failed to connect:', err);
    }
  },

  disconnect: async (id) => {
    try {
      await window.jowork.connector.stop(id);
      set((s) => ({
        connectors: s.connectors.map((c) =>
          c.id === id ? { ...c, status: 'disconnected' as const } : c,
        ),
      }));
    } catch (err) {
      console.error('Failed to disconnect:', err);
    }
  },

  checkHealth: async () => {
    try {
      const health = await window.jowork.connector.health();
      set({ health: health as Record<string, HealthStatus> });
    } catch {
      // ignore
    }
  },
}));

export function useConnectors() {
  return useConnectorStore();
}

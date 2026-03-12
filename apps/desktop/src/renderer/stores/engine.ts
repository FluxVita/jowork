import { create } from 'zustand';

export type EngineId = 'claude-code' | 'openclaw' | 'codex' | 'jowork-cloud';

interface InstallStatus {
  installed: boolean;
  version?: string;
  error?: string;
}

interface EngineStore {
  engines: Record<string, InstallStatus>;
  activeEngineId: EngineId;
  isDetecting: boolean;
  isInstalling: boolean;

  detect: () => Promise<void>;
  switchEngine: (id: EngineId) => Promise<void>;
  installEngine: (id: EngineId) => Promise<void>;
}

export const useEngineStore = create<EngineStore>((set) => ({
  engines: {},
  activeEngineId: 'claude-code',
  isDetecting: false,
  isInstalling: false,

  detect: async () => {
    set({ isDetecting: true });
    try {
      const result = await window.jowork.engine.detect();
      const active = await window.jowork.engine.getActive();
      set({ engines: result, activeEngineId: active as EngineId, isDetecting: false });
    } catch {
      set({ isDetecting: false });
    }
  },

  switchEngine: async (id) => {
    try {
      await window.jowork.engine.switchEngine(id);
      set({ activeEngineId: id });
    } catch (err) {
      console.error('Failed to switch engine:', err);
    }
  },

  installEngine: async (id) => {
    set({ isInstalling: true });
    try {
      await window.jowork.engine.install(id);
      // Re-detect after install
      const result = await window.jowork.engine.detect();
      set({ engines: result, isInstalling: false });
    } catch {
      set({ isInstalling: false });
    }
  },
}));

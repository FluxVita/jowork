import { create } from 'zustand';

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  plan: string;
}

interface ModeState {
  mode: 'personal' | 'team';
  localUserId: string;
  cloudUserId?: string;
  teamId?: string;
  teamName?: string;
}

interface AuthState {
  user: AuthUser | null;
  modeState: ModeState | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  loadModeState: () => Promise<void>;
  switchToPersonal: () => Promise<void>;
  switchToTeam: (teamId: string, teamName: string) => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  modeState: null,
  loading: false,

  loginWithGoogle: async () => {
    set({ loading: true });
    try {
      const user = await window.jowork.invoke('auth:login-google') as AuthUser;
      set({ user });
      const modeState = await window.jowork.invoke('auth:get-mode') as ModeState;
      set({ modeState });
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    await window.jowork.invoke('auth:logout');
    set({ user: null });
    const modeState = await window.jowork.invoke('auth:get-mode') as ModeState;
    set({ modeState });
  },

  refreshAuth: async () => {
    try {
      const user = await window.jowork.invoke('auth:get-user') as AuthUser | null;
      set({ user });
    } catch {
      set({ user: null });
    }
  },

  loadModeState: async () => {
    const modeState = await window.jowork.invoke('auth:get-mode') as ModeState;
    set({ modeState });
  },

  switchToPersonal: async () => {
    await window.jowork.invoke('auth:switch-personal');
    const modeState = await window.jowork.invoke('auth:get-mode') as ModeState;
    set({ modeState });
  },

  switchToTeam: async (teamId: string, teamName: string) => {
    await window.jowork.invoke('auth:switch-team', teamId, teamName);
    const modeState = await window.jowork.invoke('auth:get-mode') as ModeState;
    set({ modeState });
  },
}));

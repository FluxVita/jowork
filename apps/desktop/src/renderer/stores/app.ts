import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';

interface AppState {
  sidebarOpen: boolean;
  contextPanelOpen: boolean;
  theme: Theme;
  toggleSidebar: () => void;
  toggleContextPanel: () => void;
  setTheme: (theme: Theme) => void;
}

function applyTheme(theme: Theme): void {
  const isDark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  contextPanelOpen: false,
  theme: 'dark',
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleContextPanel: () => set((s) => ({ contextPanelOpen: !s.contextPanelOpen })),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

// Apply initial theme
applyTheme('dark');

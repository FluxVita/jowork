import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';

interface AppState {
  sidebarOpen: boolean;
  contextPanelOpen: boolean;
  theme: Theme;
  toggleSidebar: () => void;
  toggleContextPanel: () => void;
  setTheme: (theme: Theme) => void;
  initTheme: () => Promise<void>;
}

function applyTheme(theme: Theme): void {
  const isDark =
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

// Listen for OS color-scheme changes when using "system" theme
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
mediaQuery.addEventListener('change', () => {
  const state = useAppStore.getState();
  if (state.theme === 'system') applyTheme('system');
});

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  contextPanelOpen: false,
  theme: 'dark',
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleContextPanel: () => set((s) => ({ contextPanelOpen: !s.contextPanelOpen })),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
    window.jowork.settings.set('theme', theme).catch(() => {});
  },
  initTheme: async () => {
    try {
      const saved = await window.jowork.settings.get('theme');
      if (saved && (saved === 'light' || saved === 'dark' || saved === 'system')) {
        applyTheme(saved as Theme);
        set({ theme: saved as Theme });
        return;
      }
    } catch {
      // ignore
    }
    applyTheme('dark');
  },
}));

// Apply initial theme
applyTheme('dark');

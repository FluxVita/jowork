import { useEffect, useState, useCallback } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { Sidebar } from '../components/Sidebar';
import { ContextPanel } from '../components/ContextPanel';
import { GlobalSearch } from '../components/GlobalSearch';
import { ToastContainer } from '../components/Toast';
import { useAppStore } from '../stores/app';
import { useConversationStore } from '../stores/conversation';
import { useToastStore } from '../stores/toast';
import { useTranslation } from 'react-i18next';

export function MainLayout() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const contextPanelOpen = useAppStore((s) => s.contextPanelOpen);
  const navigate = useNavigate();
  const createSession = useConversationStore((s) => s.createSession);
  const selectSession = useConversationStore((s) => s.selectSession);
  const addToast = useToastStore((s) => s.addToast);
  const [searchOpen, setSearchOpen] = useState(false);

  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Listen for menu accelerator events from main process
  useEffect(() => {
    const offNav = window.jowork.on('nav:goto', (path: unknown) => {
      if (typeof path === 'string') navigate(path);
    });
    const offNewSession = window.jowork.on('shortcut:new-session', () => {
      navigate('/');
      createSession();
    });
    const offExport = window.jowork.on('shortcut:export', () => {
      const sessionId = useConversationStore.getState().activeSessionId;
      if (sessionId) window.jowork.session.export(sessionId, 'markdown');
    });
    const offNavigateSession = window.jowork.on('navigate:session', async (sessionId: unknown) => {
      if (typeof sessionId !== 'string') return;
      navigate('/');
      await selectSession(sessionId);
    });
    const offUpdateChecking = window.jowork.on('update:checking', () => {
      addToast('info', t('checking', { ns: 'settings' }), 2500);
    });
    const offUpdateAvailable = window.jowork.on('update:available', (payload: unknown) => {
      const version = typeof payload === 'object' && payload !== null && 'version' in payload
        ? String((payload as { version?: unknown }).version ?? '')
        : '';
      const base = t('updateAvailable', { ns: 'settings' });
      addToast('info', version ? `${base}: ${version}` : base);
    });
    const offUpdateDownloaded = window.jowork.on('update:downloaded', (payload: unknown) => {
      const version = typeof payload === 'object' && payload !== null && 'version' in payload
        ? String((payload as { version?: unknown }).version ?? '')
        : '';
      const base = t('updateDownloaded', { ns: 'settings' });
      addToast('success', version ? `${base}: ${version}` : base, 0);
    });
    const offUpdateError = window.jowork.on('update:error', (payload: unknown) => {
      const message = typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message?: unknown }).message ?? '')
        : t('unexpectedError', { ns: 'common' });
      addToast('error', message);
    });
    return () => {
      offNav();
      offNewSession();
      offExport();
      offNavigateSession();
      offUpdateChecking();
      offUpdateAvailable();
      offUpdateDownloaded();
      offUpdateError();
    };
  }, [navigate, createSession, selectSession, addToast, t]);

  // Cmd+K to toggle global search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen bg-surface-0 text-text-primary">
      {/* Skip to main content (keyboard accessibility) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded-md"
      >
        {t('skipToMainContent')}
      </a>

      {/* Drag region for macOS traffic lights */}
      <div className="fixed top-0 left-0 right-0 h-10 [-webkit-app-region:drag] z-50" aria-hidden="true" />

      {/* Sidebar */}
      {sidebarOpen && (
        <div className="w-[220px] flex-shrink-0 border-r border-border bg-surface-1 flex flex-col pt-10">
          <Sidebar />
        </div>
      )}

      {/* Main content */}
      <main id="main-content" className="flex-1 flex flex-col pt-10 min-w-0" role="main" tabIndex={-1}>
        <Outlet />
      </main>

      {/* Context panel */}
      {contextPanelOpen && (
        <aside className="w-[320px] flex-shrink-0 border-l border-border bg-surface-1 pt-10" aria-label="Context panel">
          <ContextPanel />
        </aside>
      )}

      {/* Global search command palette */}
      <GlobalSearch open={searchOpen} onClose={closeSearch} />

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  );
}

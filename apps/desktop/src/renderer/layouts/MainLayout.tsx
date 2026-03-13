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
import { BackgroundGradient } from '../components/ui/background-gradient';

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
      offNav(); offNewSession(); offExport(); offNavigateSession();
      offUpdateChecking(); offUpdateAvailable(); offUpdateDownloaded(); offUpdateError();
    };
  }, [navigate, createSession, selectSession, addToast, t]);

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
    <div className="relative h-screen w-screen text-foreground overflow-hidden font-sans">
      {/* Background Layer: 放大比例，提高透明度，确保可见 */}
      <div className="absolute inset-0 z-0 opacity-40 scale-[1.1]">
        <BackgroundGradient />
      </div>
      
      {/* Main Container: Flex Layout with Top Padding for Traffic Lights */}
      <div className="relative z-10 flex h-full w-full pt-8">
        
        {/* macOS Traffic Lights Region: Ensure it covers the top space for drag */}
        <div className="fixed top-0 left-0 right-0 h-10 drag-region z-50 pointer-events-none" />

        {/* Sidebar: Glass Sidebar */}
        {sidebarOpen && (
          <aside className="w-[260px] h-full flex-shrink-0 border-r border-white/5 bg-black/20 backdrop-blur-3xl flex flex-col z-20">
            <Sidebar />
          </aside>
        )}

        {/* Main Content: Flex Grow to fill space */}
        <main id="main-content" className="flex-1 h-full flex flex-col min-w-0 bg-transparent relative z-10 overflow-hidden">
          <Outlet />
        </main>

        {/* Context Panel */}
        {contextPanelOpen && (
          <aside className="w-[320px] h-full flex-shrink-0 border-l border-white/5 bg-black/20 backdrop-blur-3xl z-20">
            <ContextPanel />
          </aside>
        )}
      </div>

      <GlobalSearch open={searchOpen} onClose={closeSearch} />
      <ToastContainer />
    </div>
  );
}

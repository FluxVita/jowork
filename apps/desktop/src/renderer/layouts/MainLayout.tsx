import { Outlet } from 'react-router';
import { Sidebar } from '../components/Sidebar';
import { ContextPanel } from '../components/ContextPanel';
import { useAppStore } from '../stores/app';

export function MainLayout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const contextPanelOpen = useAppStore((s) => s.contextPanelOpen);

  return (
    <div className="flex h-screen bg-surface-0 text-text-primary">
      {/* Skip to main content (keyboard accessibility) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded-md"
      >
        Skip to main content
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
    </div>
  );
}

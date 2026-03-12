import { Outlet } from 'react-router';
import { Sidebar } from '../components/Sidebar';
import { ContextPanel } from '../components/ContextPanel';
import { useAppStore } from '../stores/app';

export function MainLayout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const contextPanelOpen = useAppStore((s) => s.contextPanelOpen);

  return (
    <div className="flex h-screen bg-surface-0 text-text-primary">
      {/* Drag region for macOS traffic lights */}
      <div className="fixed top-0 left-0 right-0 h-10 [-webkit-app-region:drag] z-50" />

      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="w-[220px] flex-shrink-0 border-r border-border bg-surface-1 flex flex-col pt-10">
          <Sidebar />
        </aside>
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col pt-10 min-w-0">
        <Outlet />
      </main>

      {/* Context panel */}
      {contextPanelOpen && (
        <aside className="w-[320px] flex-shrink-0 border-l border-border bg-surface-1 pt-10">
          <ContextPanel />
        </aside>
      )}
    </div>
  );
}

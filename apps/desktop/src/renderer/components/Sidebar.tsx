import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router';
import { SessionList } from '../features/conversation/SessionList';

const navItems = [
  { path: '/', key: 'sidebar.conversation', icon: '💬' },
  { path: '/connectors', key: 'sidebar.connectors', icon: '🔌' },
  { path: '/memories', key: 'sidebar.memories', icon: '🧠' },
  { path: '/skills', key: 'sidebar.skills', icon: '⚡' },
  { path: '/workstyle', key: 'sidebar.workstyle', icon: '✏️' },
  { path: '/scheduler', key: 'sidebar.scheduler', icon: '🕐' },
  { path: '/notifications', key: 'sidebar.notifications', icon: '🔔' },
  { path: '/terminal', key: 'sidebar.terminal', icon: '>' },
  { path: '/settings', key: 'sidebar.settings', icon: '⚙️' },
] as const;

export function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isConversation = location.pathname === '/';

  return (
    <div className="flex flex-col h-full py-2">
      {/* Brand */}
      <div className="flex items-center gap-2 px-5 mb-3">
        <span className="text-lg font-bold text-accent">JoWork</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">
          {t('sidebar.personal')}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 px-3 mb-2">
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left
                ${active ? 'bg-accent/10 text-accent font-medium' : 'text-text-secondary hover:bg-surface-2'}`}
            >
              <span>{item.icon}</span>
              <span>{t(item.key)}</span>
            </button>
          );
        })}
      </nav>

      {/* Session list (only on conversation page) */}
      {isConversation && (
        <div className="flex-1 min-h-0 border-t border-border pt-2">
          <SessionList />
        </div>
      )}

      {/* Spacer when not on conversation page */}
      {!isConversation && <div className="flex-1" />}

      {/* Bottom */}
      <div className="text-xs text-text-secondary px-5 py-2 border-t border-border">
        JoWork v0.0.1
      </div>
    </div>
  );
}

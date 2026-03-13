import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router';
import { SessionList } from '../features/conversation/SessionList';
import { useAuth } from '../features/auth/hooks/useAuth';
import { CreditBar } from '../features/billing/CreditBar';
import { NAV_ITEMS } from '../constants/navigation';

export function Sidebar() {
  const { t } = useTranslation('sidebar');
  const { t: tc } = useTranslation('common');
  const navigate = useNavigate();
  const location = useLocation();
  const isConversation = location.pathname === '/';
  const { modeState, loadModeState, user } = useAuth();
  const [version, setVersion] = useState('');

  useEffect(() => {
    loadModeState();
    window.jowork.app.getVersion().then(setVersion).catch(() => {});
  }, [loadModeState]);

  const modeBadge = modeState?.mode === 'team' && modeState.teamName
    ? tc('teamMode', { name: modeState.teamName })
    : t('personal');

  return (
    <aside className="flex flex-col h-full py-2" role="navigation" aria-label="Main navigation">
      {/* Brand + mode badge */}
      <div className="flex items-center gap-2 px-5 mb-3">
        <span className="text-lg font-bold text-accent" aria-hidden="true">JoWork</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent" role="status" aria-label={`Mode: ${modeBadge}`}>
          {modeBadge}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 px-3 mb-2" aria-label="Page navigation">
        {NAV_ITEMS.map((item) => {
          const label = t(item.key);
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors text-left
                focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
                ${active ? 'bg-accent/10 text-accent font-medium' : 'text-text-secondary hover:bg-surface-2'}`}
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Session list (only on conversation page) */}
      {isConversation && (
        <div className="flex-1 min-h-0 border-t border-border pt-2" role="region" aria-label="Conversations">
          <SessionList />
        </div>
      )}

      {/* Spacer when not on conversation page */}
      {!isConversation && <div className="flex-1" />}

      {/* Credit bar (when logged in) */}
      {user && (
        <div className="border-t border-border" role="region" aria-label="Credits">
          <CreditBar />
        </div>
      )}

      {/* Bottom */}
      <div className="text-xs text-text-secondary px-5 py-2 border-t border-border" aria-label={tc('version')}>
        JoWork {version ? `v${version}` : ''}
      </div>
    </aside>
  );
}

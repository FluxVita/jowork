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
    <aside className="flex flex-col h-full py-3" role="navigation" aria-label="Main navigation">
      {/* Brand + mode badge */}
      <div className="flex items-center gap-2.5 px-5 mb-6">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
          <span className="text-[16px] font-bold text-white tracking-tight">J</span>
        </div>
        <span className="text-[17px] font-semibold tracking-tight text-foreground" aria-hidden="true">JoWork</span>
        <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20" role="status" aria-label={`Mode: ${modeBadge}`}>
          {modeBadge}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1 px-3 mb-4" aria-label="Page navigation">
        {NAV_ITEMS.map((item) => {
          const label = t(item.key);
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-[13px] transition-all duration-300 text-left
                focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                ${active
                  ? 'bg-primary/15 text-primary font-semibold shadow-[0_4px_12px_rgba(var(--primary),0.08)] border border-primary/20'
                  : 'text-muted-foreground hover:bg-surface-2/40 hover:text-foreground active:scale-[0.98]'}`}
            >
              <span className={`w-5 text-center transition-transform duration-300 ${active ? 'scale-110' : 'group-hover:scale-110'}`} aria-hidden="true">
                {item.icon}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Session list (only on conversation page) */}
      {isConversation && (
        <div className="flex-1 min-h-0 border-t border-border/20 pt-3" role="region" aria-label="Conversations">
          <SessionList />
        </div>
      )}

      {/* Spacer when not on conversation page */}
      {!isConversation && <div className="flex-1" />}

      {/* Credit bar (when logged in) */}
      {user && (
        <div className="border-t border-border/20 p-3" role="region" aria-label="Credits">
          <CreditBar />
        </div>
      )}

      {/* Bottom */}
      <div className="text-[11px] text-muted-foreground/60 px-5 py-3 border-t border-border/20" aria-label={tc('version')}>
        JoWork {version ? `v${version}` : ''}
      </div>
    </aside>
  );
}

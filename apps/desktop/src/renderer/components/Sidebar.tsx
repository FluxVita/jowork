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
    <div className="flex flex-col h-full py-4 overflow-hidden">
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-6 mb-8">
        <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary to-[#8b5cf6] flex items-center justify-center shadow-lg shadow-primary/20 flex-shrink-0">
          <span className="text-lg font-bold text-white tracking-tighter">J</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[16px] font-bold text-white tracking-tight leading-none mb-1">JoWork</span>
          <span className="text-[10px] font-bold text-primary px-1.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 w-fit uppercase tracking-wider">
            {modeBadge}
          </span>
        </div>
      </div>

      {/* Nav Section */}
      <nav className="flex flex-col gap-1.5 px-3 mb-6 overflow-y-auto custom-scrollbar">
        {NAV_ITEMS.map((item) => {
          const label = t(item.key);
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`group flex items-center gap-3.5 px-4 py-2.5 rounded-[14px] text-[13px] font-medium transition-all duration-300 min-h-[44px]
                ${active
                  ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-[1.02]'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-white active:scale-[0.98]'}`}
            >
              <span className={`transition-transform duration-300 ${active ? 'scale-110' : 'group-hover:scale-110'}`}>
                {item.icon}
              </span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Session List: Only for Chat */}
      {isConversation && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-white/5 pt-4">
          <SessionList />
        </div>
      )}

      {/* Bottom Footer */}
      {!isConversation && <div className="flex-1" />}
      
      {user && (
        <div className="px-4 py-2 border-t border-white/5">
          <CreditBar />
        </div>
      )}
      
      <div className="px-6 py-3 text-[10px] font-bold text-muted-foreground/40 tracking-widest uppercase border-t border-white/5 bg-black/10">
        JoWork {version ? `v${version}` : 'v2.0.0'}
      </div>
    </div>
  );
}

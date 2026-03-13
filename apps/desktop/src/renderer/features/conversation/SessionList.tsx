import { useState, useMemo } from 'react';
import { useSession } from './hooks/useSession';
import { useTranslation } from 'react-i18next';

export function SessionList() {
  const { t } = useTranslation('chat');
  const { sessions, activeSessionId, selectSession, createSession, deleteSession } = useSession();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, search]);

  return (
    <div className="flex flex-col h-full" role="region" aria-label={t('conversations')}>
      <button
        onClick={createSession}
        aria-label={t('newConversation')}
        className="mx-3 mb-2 px-3 py-[7px] text-[13px] font-medium rounded-[10px] bg-accent/10 text-accent
          hover:bg-accent/15 active:scale-[0.98] transition-all duration-150
          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        + {t('newConversation')}
      </button>

      <div className="px-3 mb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchConversations')}
          aria-label={t('searchConversations')}
          className="w-full px-2.5 py-[5px] text-[12px] bg-surface-2/60 border border-border/30 rounded-lg
            text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/30
            transition-colors duration-200"
        />
      </div>

      <ul className="flex-1 overflow-y-auto px-1.5" role="listbox" aria-label={t('conversations')}>
        {filtered.map((session) => (
          <li
            key={session.id}
            role="option"
            aria-selected={activeSessionId === session.id}
            tabIndex={0}
            onClick={() => selectSession(session.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectSession(session.id);
              }
            }}
            className={`group flex items-center justify-between px-2.5 py-[7px] mx-0.5 rounded-[10px] cursor-pointer text-[13px] transition-all duration-150
              focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
              ${activeSessionId === session.id
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-text-secondary hover:bg-surface-2/60 hover:text-text-primary active:scale-[0.98]'}`}
          >
            <span className="truncate flex-1">{session.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(t('deleteConfirm', 'Delete this conversation?'))) {
                  deleteSession(session.id);
                }
              }}
              aria-label={`${t('deleteConversation')}: ${session.title}`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-secondary/50 hover:text-red-400 ml-1 text-[11px]
                focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded transition-all duration-150"
            >
              ×
            </button>
          </li>
        ))}

        {filtered.length === 0 && (
          <li className="text-[12px] text-text-secondary/60 px-3 py-6 text-center" role="presentation">
            {search ? t('noMatchingConversations') : t('noConversations')}
          </li>
        )}
      </ul>
    </div>
  );
}

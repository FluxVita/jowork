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
    <div className="flex flex-col h-full" role="region" aria-label={t('conversations', 'Conversations')}>
      <button
        onClick={createSession}
        aria-label={t('newConversation')}
        className="mx-3 mb-2 px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent-hover transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
      >
        + {t('newConversation')}
      </button>

      <div className="px-3 mb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchSessions', 'Search conversations...')}
          aria-label={t('searchSessions', 'Search conversations')}
          className="w-full px-2 py-1 text-xs bg-surface-2 border border-border rounded
            text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <ul className="flex-1 overflow-y-auto px-1" role="listbox" aria-label="Conversations">
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
            className={`group flex items-center justify-between px-3 py-2 mx-1 rounded-md cursor-pointer text-sm transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
              ${activeSessionId === session.id ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-surface-2'}`}
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
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-secondary hover:text-red-400 ml-1 text-xs
                focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded"
            >
              ×
            </button>
          </li>
        ))}

        {filtered.length === 0 && (
          <li className="text-xs text-text-secondary px-3 py-4 text-center" role="presentation">
            {search ? t('noMatchingConversations') : t('noConversations')}
          </li>
        )}
      </ul>
    </div>
  );
}

import { useState, useMemo } from 'react';
import { useSession } from './hooks/useSession';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Trash2, MessageSquare } from 'lucide-react';

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
    <div className="flex flex-col h-full overflow-hidden" role="region" aria-label={t('conversations')}>
      <div className="px-3 mb-4">
        <button
          onClick={createSession}
          aria-label={t('newConversation')}
          className="w-full flex items-center justify-center gap-2 py-2 text-[13px] font-bold rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90 active:scale-[0.98] transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          {t('newConversation', { defaultValue: 'New Chat' })}
        </button>
      </div>

      <div className="px-3 mb-4 relative group">
        <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchConversations', { defaultValue: 'Search chats...' })}
          aria-label={t('searchConversations')}
          className="w-full pl-9 pr-3 py-2 text-[12px] bg-surface-2/30 border border-border/40 rounded-xl text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
        />
      </div>

      <ul className="flex-1 overflow-y-auto custom-scrollbar px-2 space-y-1" role="listbox" aria-label={t('conversations')}>
        {filtered.map((session) => (
          <li
            key={session.id}
            role="option"
            aria-selected={activeSessionId === session.id}
            tabIndex={0}
            onClick={() => selectSession(session.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSession(session.id); } }}
            className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-300
              focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
              ${activeSessionId === session.id
                ? 'bg-primary/15 border border-primary/20 shadow-sm shadow-primary/5'
                : 'hover:bg-surface-2/40 border border-transparent hover:border-border/40'}`}
          >
            <MessageSquare className={`w-4 h-4 flex-shrink-0 ${activeSessionId === session.id ? 'text-primary' : 'text-muted-foreground opacity-60'}`} />
            <span className={`flex-1 truncate text-[13px] font-medium ${activeSessionId === session.id ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>
              {session.title}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(t('deleteConfirm', 'Delete this conversation?'))) {
                  deleteSession(session.id);
                }
              }}
              aria-label={`${t('deleteConversation')}: ${session.title}`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-md text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/10 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}

        {filtered.length === 0 && (
          <li className="py-10 text-center animate-in fade-in duration-500" role="presentation">
            <MessageSquare className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-[12px] text-muted-foreground font-medium px-4">
              {search ? t('noMatchingConversations') : t('noConversations', { defaultValue: 'No conversations yet' })}
            </p>
          </li>
        )}
      </ul>
    </div>
  );
}

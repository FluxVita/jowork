import { useSession } from './hooks/useSession';
import { useTranslation } from 'react-i18next';

export function SessionList() {
  const { t } = useTranslation('chat');
  const { sessions, activeSessionId, selectSession, createSession, deleteSession } = useSession();

  return (
    <div className="flex flex-col h-full">
      <button
        onClick={createSession}
        className="mx-3 mb-2 px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
      >
        + {t('newConversation')}
      </button>

      <div className="flex-1 overflow-y-auto px-1">
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => selectSession(session.id)}
            className={`group flex items-center justify-between px-3 py-2 mx-1 rounded-md cursor-pointer text-sm transition-colors
              ${activeSessionId === session.id ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-surface-2'}`}
          >
            <span className="truncate flex-1">{session.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteSession(session.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-text-secondary hover:text-red-400 ml-1 text-xs"
              title={t('deleteConversation')}
            >
              ×
            </button>
          </div>
        ))}

        {sessions.length === 0 && (
          <p className="text-xs text-text-secondary px-3 py-4 text-center">
            {t('noConversations')}
          </p>
        )}
      </div>
    </div>
  );
}

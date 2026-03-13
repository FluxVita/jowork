import { useTranslation } from 'react-i18next';
import { useLauncherStore } from './hooks/useLauncher';

export function LauncherResults() {
  const { t } = useTranslation('chat');
  const { response, recentQueries, isStreaming, setQuery, submit } = useLauncherStore();

  if (response) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
          {response}
          {isStreaming && <span className="inline-block w-1.5 h-4 bg-accent animate-pulse ml-0.5" />}
        </div>
      </div>
    );
  }

  if (recentQueries.length > 0) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="text-xs text-text-secondary mb-2">{t('recent')}</p>
        <div className="space-y-1">
          {recentQueries.map((q, i) => (
            <button
              key={i}
              onClick={() => {
                setQuery(q);
                submit();
              }}
              className="w-full text-left px-2 py-1.5 text-sm text-text-primary rounded
                hover:bg-white/5 transition-colors truncate"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center text-text-secondary text-xs">
      {t('launcherHint')}
    </div>
  );
}

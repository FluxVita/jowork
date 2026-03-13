import { useTranslation } from 'react-i18next';
import { useLauncherStore } from './hooks/useLauncher';
import { History, Sparkles } from 'lucide-react';

export function LauncherResults() {
  const { t } = useTranslation('chat');
  const { response, recentQueries, isStreaming, setQuery, submit } = useLauncherStore();

  if (response) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-5 animate-in fade-in duration-300">
        <div className="text-[15px] text-foreground whitespace-pre-wrap leading-relaxed">
          {response}
          {isStreaming && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />}
        </div>
      </div>
    );
  }

  if (recentQueries.length > 0) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4 animate-in fade-in duration-300">
        <div className="flex items-center gap-2 px-2 mb-3 text-[11px] font-bold text-muted-foreground/70 uppercase tracking-widest">
          <History className="w-3.5 h-3.5" />
          {t('recent')}
        </div>
        <div className="space-y-1">
          {recentQueries.map((q, i) => (
            <button
              key={i}
              onClick={() => {
                setQuery(q);
                submit();
              }}
              aria-label={`${t('recent')}: ${q}`}
              className="w-full text-left px-4 py-2.5 text-[14px] text-foreground rounded-xl
                hover:bg-white/5 transition-colors truncate flex items-center gap-3 group"
            >
              <History className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              {q}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/60 p-8 animate-in fade-in duration-500">
      <Sparkles className="w-10 h-10 mb-4 opacity-20" />
      <span className="text-[14px] font-medium">{t('launcherHint', { defaultValue: 'Type a command or ask a question' })}</span>
    </div>
  );
}
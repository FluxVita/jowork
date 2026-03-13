import { useRef, useEffect, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLauncherStore } from './hooks/useLauncher';

export function LauncherInput() {
  const { t } = useTranslation('chat');
  const { query, setQuery, submit, isStreaming } = useLauncherStore();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isStreaming) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      window.jowork.launcher.hide();
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
      <span className="text-text-secondary text-lg">🔍</span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('launcherPlaceholder')}
        disabled={isStreaming}
        className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-secondary
          focus:outline-none disabled:opacity-50"
      />
      {isStreaming && (
        <span className="text-xs text-accent animate-pulse">{t('thinking')}</span>
      )}
    </div>
  );
}

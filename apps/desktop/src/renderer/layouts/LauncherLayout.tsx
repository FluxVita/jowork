import { useTranslation } from 'react-i18next';
import { LauncherInput } from '../features/launcher/LauncherInput';
import { LauncherResults } from '../features/launcher/LauncherResults';

export function LauncherLayout() {
  const { t } = useTranslation('chat');
  return (
    <div className="glass flex flex-col h-screen rounded-2xl overflow-hidden animate-[fadeScale_0.15s_cubic-bezier(0.2,0.8,0.2,1)]">
      <LauncherInput />
      <LauncherResults />
      <div className="flex items-center justify-between px-4 py-2 border-t border-border/20 text-[10px] text-text-secondary/50">
        <span>{t('launcherTitle')}</span>
        <div className="flex items-center gap-2">
          <kbd className="px-1.5 py-0.5 bg-surface-2/40 rounded-md text-[10px]">Esc</kbd>
          <span>{t('launcherClose')}</span>
          <kbd className="px-1.5 py-0.5 bg-surface-2/40 rounded-md text-[10px]">⌘↵</kbd>
          <span>{t('launcherOpenMain')}</span>
        </div>
      </div>
    </div>
  );
}

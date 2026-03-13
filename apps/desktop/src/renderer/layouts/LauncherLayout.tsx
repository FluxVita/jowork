import { useTranslation } from 'react-i18next';
import { LauncherInput } from '../features/launcher/LauncherInput';
import { LauncherResults } from '../features/launcher/LauncherResults';

export function LauncherLayout() {
  const { t } = useTranslation('chat');
  return (
    <div className="flex flex-col h-screen bg-surface-1/95 backdrop-blur-xl rounded-xl overflow-hidden border border-border">
      <LauncherInput />
      <LauncherResults />
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border text-[10px] text-text-secondary">
        <span>{t('launcherTitle')}</span>
        <div className="flex items-center gap-2">
          <kbd className="px-1 py-0.5 bg-surface-2 rounded text-[10px]">Esc</kbd>
          <span>{t('launcherClose')}</span>
          <kbd className="px-1 py-0.5 bg-surface-2 rounded text-[10px]">⌘↵</kbd>
          <span>{t('launcherOpenMain')}</span>
        </div>
      </div>
    </div>
  );
}

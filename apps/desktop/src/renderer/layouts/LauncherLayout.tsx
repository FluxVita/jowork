import { useTranslation } from 'react-i18next';
import { LauncherInput } from '../features/launcher/LauncherInput';
import { LauncherResults } from '../features/launcher/LauncherResults';
import { BackgroundGradient } from '../components/ui/background-gradient';
import { Command } from 'lucide-react';

export function LauncherLayout() {
  const { t } = useTranslation('chat');
  return (
    <div className="relative flex flex-col h-screen rounded-[24px] overflow-hidden border border-white/20 shadow-2xl animate-in zoom-in-95 duration-200 glass-effect bg-background/60">
      <div className="absolute inset-0 opacity-40 pointer-events-none">
        <BackgroundGradient />
      </div>
      
      <div className="relative z-10 flex flex-col h-full">
        <LauncherInput />
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <LauncherResults />
        </div>
        
        {/* Footer with shortcuts */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 bg-surface-1/20 backdrop-blur-md text-[11px] font-medium text-muted-foreground/60 tracking-wide">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-primary/10 text-primary">
              <Command className="w-3.5 h-3.5" />
            </div>
            <span className="uppercase">{t('launcherTitle', { defaultValue: 'JoWork Launcher' })}</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 bg-surface-2/40 px-2 py-1 rounded-lg border border-white/5">
              <kbd className="font-sans opacity-80">Esc</kbd>
              <span className="opacity-50">{t('launcherClose', { defaultValue: 'Close' })}</span>
            </div>
            <div className="flex items-center gap-1.5 bg-primary/10 px-2 py-1 rounded-lg border border-primary/20 text-primary">
              <kbd className="font-sans">⌘ ↵</kbd>
              <span>{t('launcherOpenMain', { defaultValue: 'Open Main' })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

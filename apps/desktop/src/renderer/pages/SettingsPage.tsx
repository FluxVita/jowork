import { useTranslation } from 'react-i18next';
import { i18n } from '@jowork/core';
import { useAppStore } from '../stores/app';
import { Settings, Monitor, Languages, Keyboard } from 'lucide-react';
import { GlassCard } from '../components/ui/glass-card';

const SHORTCUT_KEYS = [
  { keys: 'Cmd+N', i18nKey: 'shortcutNewConversation' },
  { keys: 'Cmd+K', i18nKey: 'shortcutGlobalSearch' },
  { keys: 'Cmd+Shift+Space', i18nKey: 'shortcutQuickLauncher' },
  { keys: 'Cmd+E', i18nKey: 'shortcutExport' },
  { keys: 'Cmd+,', i18nKey: 'shortcutSettings' },
  { keys: 'Cmd+Enter', i18nKey: 'shortcutSend' },
  { keys: 'Escape', i18nKey: 'shortcutStop' },
  { keys: 'Cmd+Shift+T', i18nKey: 'shortcutTerminal' },
  { keys: 'Cmd+W', i18nKey: 'shortcutCloseWindow' },
] as const;

export function SettingsPage() {
  const { t } = useTranslation('settings');
  const { theme, setTheme } = useAppStore();
  const currentLang = i18n.language;

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang);
    window.jowork.settings.set('language', lang);
    window.jowork.settings.notifyLanguageChanged(lang);
  };

  return (
    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-10">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <Settings className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        </div>

        <div className="space-y-8">
          {/* Appearance */}
          <section>
            <h2 className="text-[14px] font-bold text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 ml-1">
              <Monitor className="w-4 h-4" />
              {t('appearance')}
            </h2>
            <GlassCard className="p-2">
              <div className="flex gap-2 p-1 bg-surface-1/50 rounded-xl">
                {(['light', 'dark', 'system'] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setTheme(opt)}
                    className={`flex-1 py-2.5 rounded-lg text-[14px] font-semibold transition-all duration-300
                      ${theme === opt 
                        ? 'bg-background shadow-md shadow-black/5 text-foreground' 
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface-2/40'}`}
                  >
                    {opt === 'light' ? t('themeLight') : opt === 'dark' ? t('themeDark') : t('themeSystem')}
                  </button>
                ))}
              </div>
            </GlassCard>
          </section>

          {/* Language */}
          <section>
            <h2 className="text-[14px] font-bold text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 ml-1">
              <Languages className="w-4 h-4" />
              {t('language')}
            </h2>
            <GlassCard className="p-2">
              <div className="flex gap-2 p-1 bg-surface-1/50 rounded-xl">
                {([{ code: 'zh', label: '中文' }, { code: 'en', label: 'English' }] as const).map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleLanguageChange(lang.code)}
                    className={`flex-1 py-2.5 rounded-lg text-[14px] font-semibold transition-all duration-300
                      ${currentLang === lang.code 
                        ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' 
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface-2/40'}`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </GlassCard>
          </section>

          {/* Keyboard Shortcuts */}
          <section>
            <h2 className="text-[14px] font-bold text-muted-foreground uppercase tracking-widest mb-4 flex items-center gap-2 ml-1">
              <Keyboard className="w-4 h-4" />
              {t('keyboardShortcuts')}
            </h2>
            <GlassCard className="overflow-hidden">
              <div className="divide-y divide-border/40">
                {SHORTCUT_KEYS.map((s) => (
                  <div key={s.keys} className="flex items-center justify-between px-5 py-3.5 hover:bg-surface-1/40 transition-colors">
                    <span className="text-[14px] font-medium text-foreground">{t(s.i18nKey)}</span>
                    <kbd className="text-[12px] font-mono px-2.5 py-1 bg-surface-2/50 border border-border/50 rounded-md text-muted-foreground font-bold tracking-wider">
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </GlassCard>
            <p className="text-[13px] text-muted-foreground/70 mt-3 ml-2 font-medium">
              {t('shortcutHint')}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
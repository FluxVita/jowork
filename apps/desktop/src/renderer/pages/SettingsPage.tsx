import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/app';

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

  return (
    <div className="flex-1 p-8 max-w-2xl">
      <h1 className="text-xl font-semibold mb-6">{t('title')}</h1>

      <div className="space-y-6">
        {/* Appearance */}
        <section>
          <h2 className="text-sm font-medium text-text-secondary mb-3">
            {t('appearance')}
          </h2>
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setTheme(opt)}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors
                  ${theme === opt ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary hover:text-text-primary'}`}
              >
                {opt === 'light' ? t('themeLight') : opt === 'dark' ? t('themeDark') : t('themeSystem')}
              </button>
            ))}
          </div>
        </section>

        {/* Keyboard Shortcuts */}
        <section>
          <h2 className="text-sm font-medium text-text-secondary mb-3">
            {t('keyboardShortcuts')}
          </h2>
          <div className="bg-surface-2 border border-border rounded-lg divide-y divide-border">
            {SHORTCUT_KEYS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-text-primary">{t(s.i18nKey)}</span>
                <kbd className="text-xs font-mono px-2 py-0.5 bg-surface-1 border border-border rounded text-text-secondary">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-secondary mt-2">
            {t('shortcutHint')}
          </p>
        </section>
      </div>
    </div>
  );
}

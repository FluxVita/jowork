import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/app';

const SHORTCUTS = [
  { keys: 'Cmd+N', action: 'New conversation' },
  { keys: 'Cmd+K', action: 'Global search' },
  { keys: 'Cmd+Shift+Space', action: 'Quick launcher' },
  { keys: 'Cmd+E', action: 'Export conversation' },
  { keys: 'Cmd+,', action: 'Settings' },
  { keys: 'Cmd+Enter', action: 'Send message' },
  { keys: 'Escape', action: 'Stop / close' },
  { keys: 'Cmd+Shift+T', action: 'Open terminal' },
  { keys: 'Cmd+W', action: 'Close window' },
];

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
            Keyboard Shortcuts
          </h2>
          <div className="bg-surface-2 border border-border rounded-lg divide-y divide-border">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-text-primary">{s.action}</span>
                <kbd className="text-xs font-mono px-2 py-0.5 bg-surface-1 border border-border rounded text-text-secondary">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-secondary mt-2">
            On Windows/Linux, replace Cmd with Ctrl.
          </p>
        </section>
      </div>
    </div>
  );
}

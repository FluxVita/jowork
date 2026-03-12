import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/app';

export function SettingsPage() {
  const { t } = useTranslation();
  const { theme, setTheme } = useAppStore();

  return (
    <div className="flex-1 p-8 max-w-2xl">
      <h1 className="text-xl font-semibold mb-6">{t('settings.title')}</h1>

      <div className="space-y-6">
        {/* Appearance */}
        <section>
          <h2 className="text-sm font-medium text-text-secondary mb-3">
            {t('settings.appearance')}
          </h2>
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setTheme(opt)}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors
                  ${theme === opt ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary hover:text-text-primary'}`}
              >
                {opt === 'light' ? '☀️ Light' : opt === 'dark' ? '🌙 Dark' : '💻 System'}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

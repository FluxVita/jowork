import { useTranslation } from 'react-i18next';
import { useOnboarding } from '../hooks/useOnboarding';
import { i18n } from '@jowork/core';

export function WelcomeStep() {
  const { t } = useTranslation('onboarding');
  const { nextStep, setLanguage, language } = useOnboarding();

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
    window.jowork.settings.notifyLanguageChanged(lang);
  };

  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-12">
      <div className="text-6xl mb-6 animate-bounce">🤖</div>
      <h1 className="text-2xl font-bold mb-2">{t('welcome')}</h1>
      <p className="text-text-secondary mb-8 max-w-md">{t('welcomeDescription')}</p>

      {/* Language selector */}
      <div className="flex gap-3 mb-8">
        <button
          onClick={() => handleLanguageChange('zh')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            language === 'zh' ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-2/80'
          }`}
        >
          中文
        </button>
        <button
          onClick={() => handleLanguageChange('en')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            language === 'en' ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-2/80'
          }`}
        >
          English
        </button>
      </div>

      <button
        onClick={nextStep}
        className="px-8 py-3 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors"
      >
        {t('getStarted')}
      </button>
    </div>
  );
}

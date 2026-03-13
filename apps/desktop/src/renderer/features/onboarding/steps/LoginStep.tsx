import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnboarding } from '../hooks/useOnboarding';
import { useAuth } from '../../auth/hooks/useAuth';

export function LoginStep() {
  const { t } = useTranslation('onboarding');
  const { step, nextStep, setSkippedLogin } = useOnboarding();
  const { loginWithGoogle, user } = useAuth();

  const handleSkip = () => {
    setSkippedLogin(true);
    nextStep();
  };

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
      nextStep();
    } catch {
      // Login failed/cancelled — stay on this step
    }
  };

  // Already logged in — auto-advance (in effect, not during render)
  useEffect(() => {
    if (user && step === 2) nextStep();
  }, [user, step, nextStep]);

  if (user) return null;

  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-12">
      <div className="text-5xl mb-6">🔐</div>
      <h1 className="text-xl font-bold mb-2">{t('loginTitle')}</h1>
      <p className="text-text-secondary mb-8 max-w-md">
        {t('loginDescription')}
      </p>

      <button
        onClick={handleLogin}
        className="px-8 py-3 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors mb-4"
      >
        {t('auth:signIn', { ns: 'auth' })}
      </button>

      <button
        onClick={handleSkip}
        className="text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        {t('skip')}
      </button>
    </div>
  );
}

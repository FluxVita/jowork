import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnboarding } from '../hooks/useOnboarding';

interface EngineStatus {
  id: string;
  name: string;
  detected: boolean;
}

export function EngineStep() {
  const { t } = useTranslation('onboarding');
  const { nextStep } = useOnboarding();
  const [engines, setEngines] = useState<EngineStatus[]>([]);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function detectEngines() {
      try {
        const result = await window.jowork.invoke('engine:list');
        if (mounted) {
          setEngines(result ?? []);
        }
      } catch {
        // Engine detection failed — show empty
      } finally {
        if (mounted) setChecking(false);
      }
    }

    detectEngines();
    return () => { mounted = false; };
  }, []);

  const hasEngine = engines.some((e) => e.detected);

  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-12">
      <div className="text-5xl mb-6">🧠</div>
      <h1 className="text-xl font-bold mb-2">{t('step1Title')}</h1>
      <p className="text-text-secondary mb-8 max-w-md">{t('step1Description')}</p>

      <div className="w-full max-w-sm space-y-3 mb-8">
        {checking ? (
          <div className="bg-surface rounded-lg p-4 text-sm text-text-secondary">
            {t('common:loading', { ns: 'common' })}
          </div>
        ) : (
          engines.map((engine) => (
            <div
              key={engine.id}
              className="flex items-center justify-between bg-surface rounded-lg p-4"
            >
              <span className="text-sm font-medium">{engine.name}</span>
              {engine.detected ? (
                <span className="text-green-500 text-sm">✓</span>
              ) : (
                <span className="text-text-secondary text-sm">—</span>
              )}
            </div>
          ))
        )}

        {!checking && engines.length === 0 && (
          <div className="bg-surface rounded-lg p-4 text-sm text-text-secondary">
            {t('chat:detectingEngines', { ns: 'chat' })}
          </div>
        )}
      </div>

      <button
        onClick={nextStep}
        className="px-8 py-3 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors"
      >
        {hasEngine ? t('common:next', { ns: 'common' }) : t('skip')}
      </button>
    </div>
  );
}

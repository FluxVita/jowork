import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnboarding } from '../hooks/useOnboarding';

interface ConnectorInfo {
  id: string;
  name: string;
  icon: string;
  connected: boolean;
}

const CORE_CONNECTORS = [
  { id: 'github', name: 'GitHub', icon: '🐙' },
  { id: 'gitlab', name: 'GitLab', icon: '🦊' },
  { id: 'figma', name: 'Figma', icon: '🎨' },
  { id: 'feishu', name: 'Feishu', icon: '📱' },
  { id: 'local-folder', name: 'Local Project', icon: '📁' },
];

export function ConnectorsStep() {
  const { t } = useTranslation('onboarding');
  const { nextStep, addConnector, connectedDuringOnboarding } = useOnboarding();
  const [connecting, setConnecting] = useState<string | null>(null);

  const connectors: ConnectorInfo[] = CORE_CONNECTORS.map((c) => ({
    ...c,
    connected: connectedDuringOnboarding.includes(c.id),
  }));

  const handleConnect = async (id: string) => {
    setConnecting(id);
    try {
      await window.jowork.invoke('connector:connect', id, {});
      addConnector(id);
    } catch {
      // Connection failed — user can retry
    } finally {
      setConnecting(null);
    }
  };

  return (
    <div className="flex flex-col items-center text-center px-8 py-12">
      <div className="text-5xl mb-6">🔌</div>
      <h1 className="text-xl font-bold mb-2">{t('step2Title', { defaultValue: 'Connect Your Tools' })}</h1>
      <p className="text-text-secondary mb-8 max-w-md">{t('step2Description')}</p>

      <div className="w-full max-w-sm space-y-2 mb-8">
        {connectors.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between bg-surface rounded-lg p-3"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">{c.icon}</span>
              <span className="text-sm font-medium">{c.name}</span>
            </div>
            {c.connected ? (
              <span className="text-green-500 text-sm font-medium">✓</span>
            ) : (
              <button
                onClick={() => handleConnect(c.id)}
                disabled={connecting === c.id}
                className="px-3 py-1 rounded-md text-xs bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {connecting === c.id ? t('common:loading', { ns: 'common' }) : t('connectors:connect', { ns: 'connectors' })}
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={nextStep}
        className="px-8 py-3 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors"
      >
        {connectedDuringOnboarding.length > 0 ? t('common:next', { ns: 'common' }) : t('skip')}
      </button>
    </div>
  );
}

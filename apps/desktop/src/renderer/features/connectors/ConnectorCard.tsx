import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ConnectorCardProps {
  id: string;
  name: string;
  description: string;
  category: string;
  tier: string;
  status: 'connected' | 'disconnected' | 'error';
  hasCredential: boolean;
  onConnect: (id: string, credential?: Record<string, string>) => void;
  onDisconnect: (id: string) => void;
}

const STATUS_COLORS = {
  connected: 'bg-green-400',
  disconnected: 'bg-gray-400',
  error: 'bg-red-400',
} as const;

export function ConnectorCard({
  id, name, description, category, tier, status, hasCredential,
  onConnect, onDisconnect,
}: ConnectorCardProps) {
  const { t } = useTranslation('connectors');
  const [tokenInput, setTokenInput] = useState('');
  const [showConfig, setShowConfig] = useState(false);

  const tierBadge = (t: string) => {
    const map: Record<string, string | null> = { ga: null, beta: 'tierBeta', planned: 'tierPlanned' };
    return map[t] ?? null;
  };

  const badgeKey = tierBadge(tier);

  const handleConnect = () => {
    if (!hasCredential && tokenInput) {
      onConnect(id, { accessToken: tokenInput });
      setTokenInput('');
      setShowConfig(false);
    } else {
      onConnect(id);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-surface-1 hover:bg-surface-2 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[status]}`} />
          <h3 className="font-medium text-sm">{name}</h3>
          {badgeKey && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent">
              {t(badgeKey)}
            </span>
          )}
        </div>
        <span className="text-[10px] text-text-secondary uppercase">{category}</span>
      </div>

      <p className="text-xs text-text-secondary mb-3">{description}</p>

      {showConfig && !hasCredential && (
        <div className="mb-3">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={t('tokenPlaceholder')}
            className="w-full bg-surface-0 border border-border rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}

      <div className="flex gap-2">
        {status === 'disconnected' ? (
          <>
            {!hasCredential && !showConfig ? (
              <button
                onClick={() => setShowConfig(true)}
                className="text-xs px-3 py-1 rounded bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                {t('configure')}
              </button>
            ) : (
              <button
                onClick={handleConnect}
                className="text-xs px-3 py-1 rounded bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                {t('connect')}
              </button>
            )}
          </>
        ) : (
          <button
            onClick={() => onDisconnect(id)}
            className="text-xs px-3 py-1 rounded bg-surface-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            {t('disconnect')}
          </button>
        )}
      </div>
    </div>
  );
}

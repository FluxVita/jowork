import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectorStore } from './hooks/useConnectors';
import { ConnectorCard } from './ConnectorCard';

export function ConnectorsPage() {
  const { t } = useTranslation('connectors');
  const { connectors, isLoading, loadConnectors, connect, disconnect, checkHealth } = useConnectorStore();

  useEffect(() => {
    loadConnectors();
    checkHealth();
  }, [loadConnectors, checkHealth]);

  const gaConnectors = connectors.filter((c) => c.tier === 'ga');
  const otherConnectors = connectors.filter((c) => c.tier !== 'ga');

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold mb-1">{t('title')}</h1>
        <p className="text-sm text-text-secondary mb-6">
          {t('description')}
        </p>

        {isLoading ? (
          <p className="text-sm text-text-secondary">{t('loading')}</p>
        ) : (
          <>
            {gaConnectors.length > 0 && (
              <section className="mb-8">
                <h2 className="text-sm font-medium text-text-secondary mb-3">{t('core')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {gaConnectors.map((c) => (
                    <ConnectorCard
                      key={c.id}
                      {...c}
                      onConnect={connect}
                      onDisconnect={disconnect}
                    />
                  ))}
                </div>
              </section>
            )}

            {otherConnectors.length > 0 && (
              <section>
                <h2 className="text-sm font-medium text-text-secondary mb-3">{t('more')}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {otherConnectors.map((c) => (
                    <ConnectorCard
                      key={c.id}
                      {...c}
                      onConnect={connect}
                      onDisconnect={disconnect}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

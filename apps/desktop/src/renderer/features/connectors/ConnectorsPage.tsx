import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectorStore } from './hooks/useConnectors';
import { ConnectorCard } from './ConnectorCard';

export function ConnectorsPage() {
  const { t } = useTranslation();
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
        <h1 className="text-xl font-semibold mb-1">{t('sidebar.connectors')}</h1>
        <p className="text-sm text-text-secondary mb-6">
          Connect your tools and data sources to JoWork.
        </p>

        {isLoading ? (
          <p className="text-sm text-text-secondary">Loading connectors...</p>
        ) : (
          <>
            {gaConnectors.length > 0 && (
              <section className="mb-8">
                <h2 className="text-sm font-medium text-text-secondary mb-3">Core Connectors</h2>
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
                <h2 className="text-sm font-medium text-text-secondary mb-3">More Connectors</h2>
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

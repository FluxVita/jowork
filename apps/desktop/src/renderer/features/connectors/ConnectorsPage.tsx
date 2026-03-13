import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectorStore } from './hooks/useConnectors';
import { ConnectorCard } from './ConnectorCard';
import { Database } from 'lucide-react';

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
    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
            <Database className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        </div>
        <p className="text-[15px] text-muted-foreground mb-10 pl-1">
          {t('description')}
        </p>

        {isLoading ? (
          <div className="flex items-center gap-3 text-muted-foreground p-4">
            <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-[14px]">{t('loading')}</span>
          </div>
        ) : (
          <div className="space-y-12">
            {gaConnectors.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-5">
                  <h2 className="text-lg font-semibold text-foreground tracking-tight">{t('core')}</h2>
                  <div className="h-[1px] flex-1 bg-border/40" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
                <div className="flex items-center gap-3 mb-5">
                  <h2 className="text-lg font-semibold text-foreground tracking-tight">{t('more')}</h2>
                  <div className="h-[1px] flex-1 bg-border/40" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 opacity-90 hover:opacity-100 transition-opacity">
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
          </div>
        )}
      </div>
    </div>
  );
}

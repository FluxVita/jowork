import { useTranslation } from 'react-i18next';
import { useConnectorStore } from './hooks/useConnectors';

export function HealthDashboard() {
  const { t } = useTranslation('connectors');
  const { health } = useConnectorStore();
  const entries = Object.values(health);

  if (entries.length === 0) {
    return <p className="text-xs text-text-secondary p-4">{t('noHealthData')}</p>;
  }

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium mb-3">{t('health')}</h3>
      <div className="space-y-2">
        {entries.map((h) => (
          <div key={h.connectorId} className="flex items-center gap-2 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                h.status === 'healthy' ? 'bg-green-400' :
                h.status === 'unhealthy' ? 'bg-red-400' : 'bg-gray-400'
              }`}
            />
            <span className="text-text-primary">{h.connectorId}</span>
            <span className="text-text-secondary">{h.status}</span>
            {h.error && <span className="text-red-400 truncate">{h.error}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

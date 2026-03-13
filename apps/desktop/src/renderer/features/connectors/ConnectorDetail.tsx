import { useTranslation } from 'react-i18next';

interface ConnectorDetailProps {
  connectorId: string;
  name: string;
  status: string;
}

export function ConnectorDetail({ connectorId, name, status }: ConnectorDetailProps) {
  const { t } = useTranslation('connectors');

  return (
    <div className="p-4">
      <h2 className="font-medium text-sm mb-2">{name}</h2>
      <p className="text-xs text-text-secondary mb-4">{t('status')}: {status}</p>

      <div className="space-y-3">
        <section>
          <h3 className="text-xs font-medium text-text-secondary mb-1">{t('syncedData')}</h3>
          <p className="text-xs text-text-secondary">{t('noSyncedData')}</p>
        </section>

        <section>
          <h3 className="text-xs font-medium text-text-secondary mb-1">{t('syncLog')}</h3>
          <p className="text-xs text-text-secondary">{t('noSyncActivity')}</p>
        </section>
      </div>
    </div>
  );
}

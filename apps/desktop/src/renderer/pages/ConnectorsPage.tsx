import { useTranslation } from 'react-i18next';

export function ConnectorsPage() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-4xl">🔌</div>
      <h1 className="text-xl font-semibold">{t('sidebar.connectors')}</h1>
      <p className="text-text-secondary text-sm">Phase 2 will implement connector management.</p>
    </div>
  );
}

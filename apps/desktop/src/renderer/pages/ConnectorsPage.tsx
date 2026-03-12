import { useTranslation } from 'react-i18next';

export function ConnectorsPage() {
  const { t } = useTranslation('connectors');

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-4xl">🔌</div>
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="text-text-secondary text-sm">{t('description')}</p>
    </div>
  );
}

import { useTranslation } from 'react-i18next';

interface OAuthDialogProps {
  connectorId: string;
  connectorName: string;
  onClose: () => void;
}

export function OAuthDialog({ connectorName, onClose }: OAuthDialogProps) {
  const { t } = useTranslation('connectors');
  const { t: tc } = useTranslation('common');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface-1 rounded-xl p-6 w-96 border border-border">
        <h2 className="font-medium mb-2">{t('authorizeTitle', { name: connectorName })}</h2>
        <p className="text-sm text-text-secondary mb-4">
          {t('authorizeDescription', { name: connectorName })}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md bg-surface-2 text-text-secondary hover:text-text-primary"
          >
            {tc('cancel')}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent-hover"
          >
            {t('authorize')}
          </button>
        </div>
      </div>
    </div>
  );
}

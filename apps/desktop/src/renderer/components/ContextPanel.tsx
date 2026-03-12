import { useTranslation } from 'react-i18next';

export function ContextPanel() {
  const { t } = useTranslation();

  return (
    <div className="p-4 text-sm text-text-secondary">
      <h3 className="font-medium text-text-primary mb-2">Context</h3>
      <p>Phase 2 will populate this panel with connector data and context.</p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function WorkstyleEditor() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.jowork.settings.get('workstyle').then((val) => {
      setContent(val || t('workstyleTemplate'));
    });
  }, [t]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await window.jowork.settings.set('workstyle', content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold">{t('workstyleTitle')}</h1>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/90
              disabled:opacity-50 transition-colors"
          >
            {saved ? t('saved') : saving ? tc('saving') : tc('save')}
          </button>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          {t('workstyleDescription')}
        </p>

        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setSaved(false);
          }}
          rows={20}
          className="w-full px-4 py-3 text-sm font-mono bg-surface-2 border border-border rounded-lg
            text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1
            focus:ring-accent resize-y leading-relaxed"
          placeholder={t('workstylePlaceholder')}
        />

        <p className="text-xs text-text-secondary mt-2">
          {t('workstyleHint')}
        </p>
      </div>
    </div>
  );
}

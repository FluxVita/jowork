import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, Save } from 'lucide-react';

export function WorkstyleEditor() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.jowork.settings.get('workstyle').then((val) => {
      setContent(val != null && val !== '' ? val : t('workstyleTemplate'));
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
    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar animate-in fade-in duration-500">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <Briefcase className="w-6 h-6" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('workstyleTitle')}</h1>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 text-[14px] font-semibold bg-primary text-primary-foreground rounded-xl shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95"
          >
            <Save className="w-4 h-4" />
            {saved ? t('saved') : saving ? tc('saving') : tc('save')}
          </button>
        </div>
        <p className="text-[15px] text-muted-foreground mb-10 pl-1">
          {t('workstyleDescription')}
        </p>

        <div className="glass-effect rounded-2xl border border-border/50 p-2 shadow-xl">
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setSaved(false);
            }}
            rows={20}
            className="w-full px-5 py-4 text-[14px] font-mono bg-transparent
              text-foreground placeholder:text-muted-foreground/50 focus:outline-none resize-y leading-relaxed custom-scrollbar"
            placeholder={t('workstylePlaceholder')}
          />
        </div>

        <p className="text-[13px] text-muted-foreground mt-4 pl-2 font-medium">
          {t('workstyleHint')}
        </p>
      </div>
    </div>
  );
}
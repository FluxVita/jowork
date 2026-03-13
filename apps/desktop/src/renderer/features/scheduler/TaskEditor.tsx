import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScheduledTaskInfo } from './hooks/useScheduler';
import { CronPicker } from './CronPicker';

type TaskType = 'scan' | 'skill' | 'notify';

interface Props {
  initial?: ScheduledTaskInfo;
  onSave: (data: {
    name: string;
    cronExpression: string;
    timezone: string;
    type: TaskType;
    config: Record<string, unknown>;
    enabled: boolean;
    cloudSync: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}

export function TaskEditor({ initial, onSave, onCancel }: Props) {
  const { t } = useTranslation('scheduler');
  const { t: tc } = useTranslation('common');
  const [name, setName] = useState(initial?.name ?? '');
  const [cron, setCron] = useState(initial?.cronExpression ?? '0 10 * * *');
  const [timezone, setTimezone] = useState(initial?.timezone ?? 'Asia/Shanghai');
  const [type, setType] = useState<TaskType>(initial?.type ?? 'notify');
  const [cloudSync, setCloudSync] = useState(initial?.cloudSync ?? false);
  const [saving, setSaving] = useState(false);

  const typeLabels: Record<TaskType, string> = {
    scan: t('typeScan'),
    skill: t('typeSkill'),
    notify: t('typeNotify'),
  };

  const handleSave = async () => {
    if (!name.trim() || !cron.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        cronExpression: cron.trim(),
        timezone,
        type,
        config: initial?.config ?? {},
        enabled: initial?.enabled ?? true,
        cloudSync,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('namePlaceholder')}
        className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md
          text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
      />

      <CronPicker value={cron} onChange={setCron} />

      <input
        type="text"
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
        placeholder={t('timezonePlaceholder')}
        className="w-full px-3 py-2 text-sm bg-surface-2 border border-border rounded-md
          text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
      />

      <div className="flex items-center gap-4">
        {(['scan', 'skill', 'notify'] as const).map((tp) => (
          <label key={tp} className="flex items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="radio"
              name="type"
              checked={type === tp}
              onChange={() => setType(tp)}
              className="accent-accent"
            />
            {typeLabels[tp]}
          </label>
        ))}
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={cloudSync}
          onChange={(e) => setCloudSync(e.target.checked)}
          className="accent-accent"
        />
        {t('cloudExecution')}
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary">
          {tc('cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="px-3 py-1.5 text-sm bg-accent text-white rounded-md hover:bg-accent/90
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? tc('saving') : initial ? tc('update') : tc('create')}
        </button>
      </div>
    </div>
  );
}

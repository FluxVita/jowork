import { useTranslation } from 'react-i18next';
import type { ScheduledTaskInfo } from './hooks/useScheduler';

interface Props {
  task: ScheduledTaskInfo;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onViewHistory: (id: string) => void;
}

function formatTime(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

export function TaskCard({ task, onEdit, onDelete, onToggle, onViewHistory }: Props) {
  const { t } = useTranslation('scheduler');
  const { t: tc } = useTranslation('common');

  const typeLabel: Record<string, string> = {
    scan: t('typeScan'),
    skill: t('typeSkill'),
    notify: t('typeNotify'),
  };

  return (
    <div className="group p-3 bg-surface-2 border border-border rounded-lg hover:border-accent/30 transition-colors">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggle(task.id, !task.enabled)}
            className={`w-8 h-4 rounded-full transition-colors relative ${
              task.enabled ? 'bg-accent' : 'bg-surface-1 border border-border'
            }`}
          >
            <span
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                task.enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span className="text-sm font-medium text-text-primary">{task.name}</span>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onViewHistory(task.id)} className="text-xs text-text-secondary hover:text-accent px-1">
            {t('history')}
          </button>
          <button onClick={() => onEdit(task.id)} className="text-xs text-text-secondary hover:text-accent px-1">
            {tc('edit')}
          </button>
          <button onClick={() => onDelete(task.id)} className="text-xs text-text-secondary hover:text-red-400 px-1">
            {tc('delete')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-text-secondary">
        <code className="px-1.5 py-0.5 bg-surface-1 rounded">{task.cronExpression}</code>
        <span className="px-1.5 py-0.5 bg-accent/10 text-accent rounded">{typeLabel[task.type]}</span>
        {task.cloudSync && (
          <span className="px-1.5 py-0.5 bg-blue-400/10 text-blue-400 rounded">{t('cloud')}</span>
        )}
      </div>

      <div className="flex items-center gap-4 mt-2 text-[10px] text-text-secondary">
        <span>{t('lastRunShort')} {formatTime(task.lastRunAt)}</span>
        <span>{t('nextRunShort')} {formatTime(task.nextRunAt)}</span>
      </div>
    </div>
  );
}

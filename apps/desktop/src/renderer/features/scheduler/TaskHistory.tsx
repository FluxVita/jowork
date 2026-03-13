import { useTranslation } from 'react-i18next';
import type { TaskExecution } from './hooks/useScheduler';

interface Props {
  executions: TaskExecution[];
  onClose: () => void;
}

const statusStyles: Record<string, string> = {
  success: 'text-green-400',
  failure: 'text-red-400',
  skipped: 'text-yellow-400',
};

export function TaskHistory({ executions, onClose }: Props) {
  const { t } = useTranslation('scheduler');
  const { t: tc } = useTranslation('common');

  return (
    <div className="p-3 bg-surface-1 border border-border rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-text-primary">{t('executionHistory')}</h3>
        <button onClick={onClose} className="text-xs text-text-secondary hover:text-text-primary">
          {tc('close')}
        </button>
      </div>

      {executions.length === 0 ? (
        <p className="text-xs text-text-secondary py-2">{t('noExecutions')}</p>
      ) : (
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {executions.map((exec) => (
            <div key={exec.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-border last:border-0">
              <span className={`font-medium ${statusStyles[exec.status] ?? 'text-text-secondary'}`}>
                {exec.status}
              </span>
              <span className="text-text-secondary">
                {new Date(exec.executedAt).toLocaleString()}
              </span>
              {exec.durationMs != null && (
                <span className="text-text-secondary">{exec.durationMs}ms</span>
              )}
              {exec.error && (
                <span className="text-red-400 truncate flex-1">{exec.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

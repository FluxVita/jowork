import { useTranslation } from 'react-i18next';
import { useEngine } from './hooks/useEngine';

export function EngineIndicator() {
  const { t } = useTranslation('chat');
  const { engines, activeEngineId, isDetecting } = useEngine();
  const status = engines[activeEngineId];

  const engineLabels: Record<string, string> = {
    'claude-code': t('engineClaudeCode'),
    'openclaw': t('engineOpenClaw'),
    'codex': t('engineCodex'),
    'jowork-cloud': t('engineJoworkCloud'),
  };

  if (isDetecting) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-text-secondary px-3 py-1">
        <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
        {t('detectingEngines')}
      </div>
    );
  }

  const installed = status?.installed;
  const label = engineLabels[activeEngineId] ?? activeEngineId;

  return (
    <div className="flex items-center gap-1.5 text-xs text-text-secondary px-3 py-1">
      <span className={`w-2 h-2 rounded-full ${installed ? 'bg-green-400' : 'bg-red-400'}`} />
      <span>{label}</span>
      {status?.version && <span className="opacity-60">v{status.version}</span>}
      {!installed && <span className="text-red-400 ml-1">{t('notInstalled')}</span>}
    </div>
  );
}

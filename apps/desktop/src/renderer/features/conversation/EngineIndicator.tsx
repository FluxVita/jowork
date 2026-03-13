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
      <div className="flex items-center gap-2 text-[12px] text-text-secondary/60 px-3 py-2">
        <span className="w-[6px] h-[6px] bg-yellow-500/80 rounded-full animate-[dotPulse_1.4s_ease-in-out_infinite]" />
        {t('detectingEngines')}
      </div>
    );
  }

  const installed = status?.installed;
  const label = engineLabels[activeEngineId] ?? activeEngineId;

  return (
    <div className="flex items-center gap-2 text-[12px] text-text-secondary/70 px-3 py-2">
      <span className={`w-[6px] h-[6px] rounded-full ${installed ? 'bg-green-500' : 'bg-red-500'}`} />
      <span>{label}</span>
      {status?.version && <span className="opacity-40 font-mono text-[11px]">v{status.version}</span>}
      {!installed && <span className="text-red-400/80 ml-0.5">{t('notInstalled')}</span>}
    </div>
  );
}

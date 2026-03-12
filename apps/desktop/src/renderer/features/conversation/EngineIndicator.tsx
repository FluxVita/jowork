import { useEngine } from './hooks/useEngine';

const ENGINE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'openclaw': 'OpenClaw',
  'codex': 'Codex',
  'jowork-cloud': 'JoWork Cloud',
};

export function EngineIndicator() {
  const { engines, activeEngineId, isDetecting } = useEngine();
  const status = engines[activeEngineId];

  if (isDetecting) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-text-secondary px-3 py-1">
        <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
        Detecting engines...
      </div>
    );
  }

  const installed = status?.installed;
  const label = ENGINE_LABELS[activeEngineId] ?? activeEngineId;

  return (
    <div className="flex items-center gap-1.5 text-xs text-text-secondary px-3 py-1">
      <span className={`w-2 h-2 rounded-full ${installed ? 'bg-green-400' : 'bg-red-400'}`} />
      <span>{label}</span>
      {status?.version && <span className="opacity-60">v{status.version}</span>}
      {!installed && <span className="text-red-400 ml-1">not installed</span>}
    </div>
  );
}

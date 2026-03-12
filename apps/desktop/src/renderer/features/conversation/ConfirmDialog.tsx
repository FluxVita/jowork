import { useState } from 'react';

interface ConfirmAction {
  toolName: string;
  description: string;
  params: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
}

interface Props {
  action: ConfirmAction;
  onAllow: (alwaysAllow?: boolean) => void;
  onDeny: () => void;
}

const riskStyles = {
  low: 'border-green-400/30 bg-green-400/5',
  medium: 'border-yellow-400/30 bg-yellow-400/5',
  high: 'border-red-400/30 bg-red-400/5',
};

const riskLabels = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

export function ConfirmDialog({ action, onAllow, onDeny }: Props) {
  const [rememberChoice, setRememberChoice] = useState(false);

  return (
    <div className={`p-4 rounded-lg border ${riskStyles[action.risk]}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-text-primary">Action Confirmation</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          action.risk === 'high' ? 'bg-red-400/20 text-red-400' :
          action.risk === 'medium' ? 'bg-yellow-400/20 text-yellow-400' :
          'bg-green-400/20 text-green-400'
        }`}>
          {riskLabels[action.risk]}
        </span>
      </div>

      <p className="text-xs text-text-secondary mb-2">{action.description}</p>

      <div className="text-xs font-mono bg-surface-2 p-2 rounded mb-3 overflow-x-auto">
        <span className="text-accent">{action.toolName}</span>
        {Object.entries(action.params).length > 0 && (
          <pre className="text-text-secondary mt-1">
            {JSON.stringify(action.params, null, 2)}
          </pre>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            className="accent-accent"
          />
          Always allow this action
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={onDeny}
            className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary
              border border-border rounded transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => onAllow(rememberChoice)}
            className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/90 transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  low: 'border-green-500/20 bg-green-500/5',
  medium: 'border-yellow-500/20 bg-yellow-500/5',
  high: 'border-red-500/20 bg-red-500/5',
};

const riskDotStyles = {
  low: 'bg-green-500',
  medium: 'bg-yellow-500',
  high: 'bg-red-500',
};

export function ConfirmDialog({ action, onAllow, onDeny }: Props) {
  const { t } = useTranslation('chat');
  const [rememberChoice, setRememberChoice] = useState(false);

  const riskLabels = {
    low: t('riskLow'),
    medium: t('riskMedium'),
    high: t('riskHigh'),
  };

  return (
    <div className={`p-4 rounded-2xl border backdrop-blur-sm ${riskStyles[action.risk]}`}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`w-2 h-2 rounded-full ${riskDotStyles[action.risk]}`} />
        <span className="text-[14px] font-medium text-text-primary">{t('actionConfirmation')}</span>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
          action.risk === 'high' ? 'bg-red-500/15 text-red-400' :
          action.risk === 'medium' ? 'bg-yellow-500/15 text-yellow-400' :
          'bg-green-500/15 text-green-400'
        }`}>
          {riskLabels[action.risk]}
        </span>
      </div>

      <p className="text-[13px] text-text-secondary mb-2.5 leading-relaxed">{action.description}</p>

      <div className="text-[12px] font-mono bg-surface-0/60 p-3 rounded-xl mb-3.5 overflow-x-auto border border-border/20">
        <span className="text-accent">{action.toolName}</span>
        {Object.entries(action.params).length > 0 && (
          <pre className="text-text-secondary/80 mt-1">
            {JSON.stringify(action.params, null, 2)}
          </pre>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            className="accent-accent w-3.5 h-3.5 rounded"
          />
          {t('alwaysAllow')}
        </label>

        <div className="flex items-center gap-2">
          <button
            onClick={onDeny}
            className="px-3.5 py-[6px] text-[13px] text-text-secondary hover:text-text-primary
              border border-border/40 rounded-xl hover:bg-surface-2/40 active:scale-[0.97] transition-all duration-150"
          >
            {t('deny')}
          </button>
          <button
            onClick={() => onAllow(rememberChoice)}
            className="px-3.5 py-[6px] text-[13px] font-medium bg-accent text-white rounded-xl
              hover:bg-accent-hover active:scale-[0.97] transition-all duration-150"
          >
            {t('allow')}
          </button>
        </div>
      </div>
    </div>
  );
}

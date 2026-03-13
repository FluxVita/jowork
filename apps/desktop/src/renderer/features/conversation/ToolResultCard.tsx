import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ToolResultCardProps {
  toolName?: string;
  content: string;
}

export function ToolResultCard({ toolName, content }: ToolResultCardProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const preview = content.length > 120 ? content.slice(0, 120) + '...' : content;

  return (
    <div className="mb-3 ml-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[12px] text-text-secondary/70 hover:text-text-primary transition-all duration-150 group"
      >
        <span className={`transition-transform duration-200 text-[10px] ${expanded ? 'rotate-90' : ''}`}>▶</span>
        {toolName && <span className="font-mono bg-surface-2/60 px-2 py-0.5 rounded-md text-[11px] group-hover:bg-surface-2 transition-colors duration-150">{toolName}</span>}
        <span className="text-green-400/80">{t('toolResult')}</span>
      </button>
      <pre className="mt-2 ml-5 text-[11px] bg-surface-0/60 rounded-xl p-3 overflow-x-auto text-text-secondary max-h-40 border border-border/20">
        {expanded ? content : preview}
      </pre>
    </div>
  );
}

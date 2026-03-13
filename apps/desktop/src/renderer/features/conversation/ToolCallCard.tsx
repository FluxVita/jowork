import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ToolCallCardProps {
  toolName: string;
  content: string;
}

export function ToolCallCard({ toolName, content }: ToolCallCardProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-3 ml-2">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-label={`${expanded ? t('collapse') : t('expand')} ${toolName}`}
        aria-expanded={expanded}
        className="flex items-center gap-2 text-[12px] text-text-secondary/70 hover:text-text-primary transition-all duration-150 group"
      >
        <span className={`transition-transform duration-200 text-[10px] ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span className="font-mono bg-surface-2/60 px-2 py-0.5 rounded-md text-[11px] group-hover:bg-surface-2 transition-colors duration-150">{toolName}</span>
        <span>{t('toolCall')}</span>
      </button>
      {expanded && content && (
        <pre className="mt-2 ml-5 text-[11px] bg-surface-0/60 rounded-xl p-3 overflow-x-auto text-text-secondary border border-border/20">
          {content}
        </pre>
      )}
    </div>
  );
}

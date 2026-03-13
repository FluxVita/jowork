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
        className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <span className="font-mono bg-surface-2 px-2 py-0.5 rounded">{toolName}</span>
        <span className="text-text-secondary">{t('toolCall')}</span>
      </button>
      {expanded && content && (
        <pre className="mt-1.5 ml-5 text-xs bg-surface-0 rounded-md p-2 overflow-x-auto text-text-secondary">
          {content}
        </pre>
      )}
    </div>
  );
}

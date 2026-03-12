import { useState } from 'react';

interface ToolResultCardProps {
  toolName?: string;
  content: string;
}

export function ToolResultCard({ toolName, content }: ToolResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.length > 120 ? content.slice(0, 120) + '...' : content;

  return (
    <div className="mb-3 ml-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        {toolName && <span className="font-mono bg-surface-2 px-2 py-0.5 rounded">{toolName}</span>}
        <span className="text-green-400">result</span>
      </button>
      <pre className="mt-1.5 ml-5 text-xs bg-surface-0 rounded-md p-2 overflow-x-auto text-text-secondary max-h-40">
        {expanded ? content : preview}
      </pre>
    </div>
  );
}

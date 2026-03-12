import { useMemo } from 'react';

interface StreamingTextProps {
  text: string;
}

/**
 * Renders streaming markdown text incrementally.
 * Phase 1: simple rendering with code block detection.
 * TODO: integrate markdown-it for full markdown support.
 */
export function StreamingText({ text }: StreamingTextProps) {
  const rendered = useMemo(() => {
    if (!text) return null;

    const parts: { type: 'text' | 'code'; content: string; lang?: string }[] = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', content: match[2], lang: match[1] || undefined });
      lastIndex = match.index + match[0].length;
    }

    // Remaining text (including incomplete code blocks during streaming)
    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    return parts;
  }, [text]);

  if (!rendered) return null;

  return (
    <div className="prose prose-sm prose-invert max-w-none">
      {rendered.map((part, i) =>
        part.type === 'code' ? (
          <pre key={i} className="bg-surface-0 rounded-md p-3 my-2 overflow-x-auto">
            {part.lang && (
              <div className="text-xs text-text-secondary mb-1">{part.lang}</div>
            )}
            <code className="text-sm">{part.content}</code>
          </pre>
        ) : (
          <span key={i} className="whitespace-pre-wrap">{part.content}</span>
        ),
      )}
      <span className="inline-block w-2 h-4 bg-accent/60 animate-pulse ml-0.5" />
    </div>
  );
}

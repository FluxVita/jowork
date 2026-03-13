import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const renderedHtml = useMemo(() => {
    if (role !== 'assistant') return '';
    const raw = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [role, content]);

  if (role === 'system') {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-text-secondary bg-surface-2 px-3 py-1 rounded-full">
          {content}
        </span>
      </div>
    );
  }

  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed
          ${isUser
            ? 'bg-accent text-white rounded-br-md'
            : 'bg-surface-2 text-text-primary rounded-bl-md'
          }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <div
            className="prose prose-sm prose-invert max-w-none
              [&_pre]:bg-surface-0 [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto
              [&_code]:text-sm [&_code]:text-accent
              [&_pre_code]:text-text-primary [&_pre_code]:bg-transparent
              [&_a]:text-accent [&_a]:no-underline hover:[&_a]:underline
              [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-4"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}
      </div>
    </div>
  );
}

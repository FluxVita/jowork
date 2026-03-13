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
      <div className="flex justify-center py-3">
        <span className="text-[11px] text-text-secondary/70 bg-surface-2/60 px-3.5 py-1 rounded-full backdrop-blur-sm">
          {content}
        </span>
      </div>
    );
  }

  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-[20px] px-4 py-2.5 text-[14px] leading-relaxed
          ${isUser
            ? 'bg-accent text-white rounded-br-lg'
            : 'bg-surface-2/70 text-text-primary rounded-bl-lg shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)]'
          }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <div
            className="prose prose-sm prose-invert max-w-none
              [&_pre]:bg-surface-0/80 [&_pre]:rounded-xl [&_pre]:p-3.5 [&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:text-[13px]
              [&_code]:text-[13px] [&_code]:text-accent
              [&_pre_code]:text-text-primary [&_pre_code]:bg-transparent
              [&_a]:text-accent [&_a]:no-underline hover:[&_a]:underline
              [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-4
              [&_p]:my-1.5 first:[&_p]:mt-0 last:[&_p]:mb-0"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}
      </div>
    </div>
  );
}

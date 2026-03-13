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
      <div className="flex justify-center py-4">
        <span className="text-[12px] text-muted-foreground bg-surface-2/40 px-4 py-1.5 rounded-full border border-border/50 backdrop-blur-md shadow-sm">
          {content}
        </span>
      </div>
    );
  }

  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-6 group`}>
      <div
        className={`max-w-[85%] rounded-[24px] px-5 py-3.5 text-[15px] leading-relaxed transition-all duration-300
          ${isUser
            ? 'bg-gradient-to-br from-primary to-accent text-primary-foreground rounded-br-md shadow-[0_8px_24px_rgba(var(--primary),0.25)] border border-white/10'
            : 'glass-effect text-foreground rounded-bl-md shadow-lg border-border/80'
          }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap font-medium">{content}</div>
        ) : (
          <div
            className="prose prose-sm prose-invert max-w-none
              [&_pre]:bg-background/80 [&_pre]:rounded-2xl [&_pre]:p-4 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:text-[13px] [&_pre]:border [&_pre]:border-white/5
              [&_code]:text-[13px] [&_code]:text-primary [&_code]:bg-primary/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md
              [&_pre_code]:text-foreground [&_pre_code]:bg-transparent [&_pre_code]:px-0
              [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-primary/80
              [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-4 [&_li]:my-1
              [&_p]:my-2 first:[&_p]:mt-0 last:[&_p]:mb-0
              [&_strong]:text-foreground [&_strong]:font-semibold"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        )}
      </div>
    </div>
  );
}

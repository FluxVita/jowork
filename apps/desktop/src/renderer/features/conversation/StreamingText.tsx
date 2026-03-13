import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface StreamingTextProps {
  text: string;
}

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * Renders streaming markdown text with full markdown support via marked.
 * Handles incomplete code blocks gracefully during streaming.
 */
export function StreamingText({ text }: StreamingTextProps) {
  const html = useMemo(() => {
    if (!text) return '';

    // Handle incomplete code blocks during streaming
    // Count opening ``` and closing ``` to detect if we're mid-block
    const fences = text.match(/```/g);
    let safeText = text;
    if (fences && fences.length % 2 !== 0) {
      // Odd number = unclosed code block, close it so marked renders properly
      safeText += '\n```';
    }

    return DOMPurify.sanitize(marked.parse(safeText, { async: false }) as string);
  }, [text]);

  if (!html) return null;

  return (
    <div className="streaming-text">
      <div
        className="prose prose-sm prose-invert max-w-none
          [&_pre]:bg-surface-0/80 [&_pre]:rounded-xl [&_pre]:p-3.5 [&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:text-[13px] [&_pre]:border [&_pre]:border-border/20
          [&_code]:text-[13px] [&_code]:text-accent
          [&_pre_code]:text-text-primary [&_pre_code]:bg-transparent
          [&_a]:text-accent [&_a]:no-underline hover:[&_a]:underline
          [&_table]:border-collapse [&_th]:border [&_th]:border-border/30 [&_th]:p-2
          [&_td]:border [&_td]:border-border/30 [&_td]:p-2
          [&_blockquote]:border-l-2 [&_blockquote]:border-accent/30 [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary
          [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-4
          [&_hr]:border-border/30
          [&_p]:my-1.5 first:[&_p]:mt-0 last:[&_p]:mb-0"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <span className="inline-block w-[3px] h-[18px] bg-accent/70 rounded-full ml-0.5 animate-[cursorBlink_1s_ease-in-out_infinite]" />
    </div>
  );
}

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
          [&_pre]:bg-surface-0 [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto
          [&_code]:text-sm [&_code]:text-accent
          [&_pre_code]:text-text-primary [&_pre_code]:bg-transparent
          [&_a]:text-accent [&_a]:no-underline hover:[&_a]:underline
          [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:p-2
          [&_td]:border [&_td]:border-border [&_td]:p-2
          [&_blockquote]:border-l-2 [&_blockquote]:border-accent/40 [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary
          [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-4
          [&_hr]:border-border"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <span className="inline-block w-2 h-4 bg-accent/60 animate-pulse ml-0.5" />
    </div>
  );
}

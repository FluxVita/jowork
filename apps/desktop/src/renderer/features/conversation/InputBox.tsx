import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface InputBoxProps {
  onSend: (message: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  /** When this value changes, the textarea re-focuses (e.g. session switch). */
  focusKey?: string | null;
}

export function InputBox({ onSend, onAbort, isStreaming, focusKey }: InputBoxProps) {
  const { t } = useTranslation('chat');
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Re-focus textarea on mount and when session changes
  useEffect(() => {
    textareaRef.current?.focus();
  }, [focusKey]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, isStreaming, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape' && isStreaming) {
      e.preventDefault();
      onAbort();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const contents: string[] = [];
    for (const file of files) {
      try {
        const result = await window.jowork.file.readForChat(file.path);
        if (result) {
          contents.push(`[File: ${file.name}]\n${result}`);
        }
      } catch {
        contents.push(`[File: ${file.name}] (failed to read)`);
      }
    }

    if (contents.length > 0) {
      setText((prev) => prev + (prev ? '\n\n' : '') + contents.join('\n\n'));
      textareaRef.current?.focus();
    }
  };

  return (
    <div
      className={`p-4 transition-all duration-200 ${dragOver ? 'bg-accent/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={`flex gap-2.5 items-end max-w-3xl mx-auto rounded-2xl border bg-surface-1 px-3 py-2 transition-all duration-200
        ${dragOver
          ? 'border-accent/40 shadow-[0_0_0_3px_rgba(94,92,230,0.1)]'
          : 'border-border/40 shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
        }`}
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={dragOver ? t('dropFilesHere') : t('placeholder')}
          aria-label={t('inputAriaLabel')}
          rows={1}
          className="flex-1 resize-none bg-transparent text-text-primary text-[14px] leading-relaxed py-1.5 px-1
            placeholder:text-text-secondary/50 focus:outline-none
            min-h-[36px] max-h-[200px]"
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            aria-label={t('stopAriaLabel')}
            className="px-3.5 py-1.5 rounded-xl bg-red-500/10 text-red-400 text-[13px] font-medium
              hover:bg-red-500/20 active:scale-[0.96] transition-all duration-150 flex-shrink-0"
          >
            {t('stop')}
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            aria-label={t('sendAriaLabel')}
            className="p-2 rounded-xl bg-accent text-white
              hover:bg-accent-hover active:scale-[0.94] transition-all duration-150
              disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100 flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

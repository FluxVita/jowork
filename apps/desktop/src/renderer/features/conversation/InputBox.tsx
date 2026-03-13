import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square } from 'lucide-react';

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
      className={`p-4 pb-6 transition-all duration-300 bg-transparent`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={`flex gap-3 items-end max-w-4xl mx-auto rounded-[24px] px-4 py-3 transition-all duration-300
        ${dragOver
          ? 'glass-effect border-primary/40 shadow-[0_0_0_4px_rgba(var(--primary),0.1)] scale-[1.01]'
          : 'glass-effect border-border shadow-lg shadow-black/5 hover:border-primary/20'
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
          className="flex-1 resize-none bg-transparent text-foreground text-[15px] leading-relaxed py-2 px-1
            placeholder:text-muted-foreground/60 focus:outline-none
            min-h-[40px] max-h-[240px]"
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            aria-label={t('stopAriaLabel')}
            className="p-3 mb-0.5 rounded-[14px] bg-red-500/10 text-red-500 border border-red-500/20
              hover:bg-red-500/20 active:scale-[0.96] transition-all duration-200 flex-shrink-0"
          >
            <Square className="w-5 h-5 fill-current" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            aria-label={t('sendAriaLabel')}
            className="p-3 mb-0.5 rounded-[14px] bg-primary text-primary-foreground shadow-md shadow-primary/20
              hover:opacity-90 active:scale-[0.94] transition-all duration-200
              disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed disabled:active:scale-100 flex-shrink-0"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}

import { useState, useRef, useCallback, type KeyboardEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface InputBoxProps {
  onSend: (message: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
}

export function InputBox({ onSend, onAbort, isStreaming }: InputBoxProps) {
  const { t } = useTranslation('chat');
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      className={`border-t border-border p-4 transition-colors ${dragOver ? 'bg-accent/5 border-accent' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex gap-2 items-end max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={dragOver ? t('dropFilesHere') : t('placeholder')}
          aria-label={t('inputAriaLabel')}
          rows={1}
          className="flex-1 resize-none bg-surface-2 text-text-primary rounded-lg px-4 py-2.5 text-sm
            placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent
            min-h-[40px] max-h-[200px]"
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            aria-label={t('stopAriaLabel')}
            className="px-4 py-2.5 rounded-lg bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-colors flex-shrink-0"
          >
            {t('stop')}
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            aria-label={t('sendAriaLabel')}
            className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm hover:bg-accent-hover transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            {t('send')}
          </button>
        )}
      </div>
    </div>
  );
}

import { useState, useRef, useCallback, type KeyboardEvent } from 'react';

interface InputBoxProps {
  onSend: (message: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
}

export function InputBox({ onSend, onAbort, isStreaming }: InputBoxProps) {
  const [text, setText] = useState('');
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

  return (
    <div className="border-t border-border p-4">
      <div className="flex gap-2 items-end max-w-3xl mx-auto">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Type a message... (Cmd+Enter to send)"
          rows={1}
          className="flex-1 resize-none bg-surface-2 text-text-primary rounded-lg px-4 py-2.5 text-sm
            placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent
            min-h-[40px] max-h-[200px]"
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            className="px-4 py-2.5 rounded-lg bg-red-500/10 text-red-400 text-sm hover:bg-red-500/20 transition-colors flex-shrink-0"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim()}
            className="px-4 py-2.5 rounded-lg bg-accent text-white text-sm hover:bg-accent-hover transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square, Paperclip, Loader2 } from 'lucide-react';

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
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 240) + 'px';
    }
  };

  return (
    <div className={`relative w-full max-w-4xl mx-auto transition-all duration-300 ${dragOver ? 'scale-[1.01]' : ''}`}>
      {/* Container with Glass Effect and stronger border */}
      <div 
        className={`flex items-end gap-3 p-3 glass-effect rounded-[24px] border border-white/10 shadow-2xl transition-all duration-300
          ${dragOver ? 'border-primary shadow-primary/20 bg-primary/5' : 'hover:border-white/20'}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); }}
      >
        {/* Attach Button */}
        <button className="flex-shrink-0 p-2.5 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all active:scale-90">
          <Paperclip className="w-5 h-5" />
        </button>
        
        {/* Textarea: Fixed line-height and padding for alignment */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={dragOver ? 'Drop files here...' : t('placeholder', { defaultValue: 'Ask anything...' })}
          className="flex-1 bg-transparent border-none text-foreground text-[15px] leading-[1.6] py-2 focus:outline-none focus:ring-0 resize-none min-h-[44px] max-h-[200px] custom-scrollbar"
          rows={1}
        />
        
        {/* Status / Action Button */}
        <div className="flex-shrink-0">
          {isStreaming ? (
            <button
              onClick={onAbort}
              className="p-3 rounded-2xl bg-red-500 text-white shadow-lg shadow-red-500/20 hover:bg-red-600 transition-all active:scale-95 flex items-center justify-center"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!text.trim()}
              className="p-3 rounded-2xl bg-primary text-white shadow-lg shadow-primary/30 hover:opacity-90 transition-all active:scale-90 disabled:opacity-30 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

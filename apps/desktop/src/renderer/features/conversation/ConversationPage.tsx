import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from './hooks/useChat';
import { MessageList } from './MessageList';
import { InputBox } from './InputBox';
import { EngineIndicator } from './EngineIndicator';
import { ConfirmDialog } from './ConfirmDialog';
import { useConversationStore } from '../../stores/conversation';

export function ConversationPage() {
  const { t } = useTranslation('chat');
  const { sendMessage, abort, isStreaming, streamingText, messages } = useChat();
  const activeSessionId = useConversationStore((s) => s.activeSessionId);
  const pendingConfirm = useConversationStore((s) => s.pendingConfirm);
  const resolveConfirm = useConversationStore((s) => s.resolveConfirm);
  const hasMoreMessages = useConversationStore((s) => s.hasMoreMessages);
  const isLoadingMore = useConversationStore((s) => s.isLoadingMore);
  const loadMoreMessages = useConversationStore((s) => s.loadMoreMessages);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const handleExport = useCallback(async (format: 'markdown' | 'json') => {
    if (!activeSessionId) return;
    setShowExportMenu(false);
    try {
      await window.jowork.session.export(activeSessionId, format);
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [activeSessionId]);

  // Close export menu on click outside or Escape
  useEffect(() => {
    if (!showExportMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showExportMenu]);

  return (
    <div className="flex flex-col h-full">
      {/* Engine status bar */}
      <div className="flex items-center justify-between border-b border-border/30 px-2">
        <EngineIndicator />
        <div className="flex items-center gap-1">
          {activeSessionId && messages.length > 0 && (
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                aria-expanded={showExportMenu}
                aria-haspopup="menu"
                className="text-[12px] text-text-secondary/70 hover:text-text-primary px-2.5 py-1.5 rounded-lg
                  hover:bg-surface-2/60 active:scale-[0.97] transition-all duration-150"
                title={t('exportConversation')}
              >
                {t('export')}
              </button>
              {showExportMenu && (
                <div role="menu" className="glass absolute right-0 top-full mt-1.5 rounded-xl z-10 py-1 min-w-[140px] animate-[fadeScale_0.15s_ease-out]">
                  <button
                    role="menuitem"
                    onClick={() => handleExport('markdown')}
                    className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-surface-2/40 transition-colors duration-150 rounded-lg mx-0"
                  >
                    {t('exportMarkdown')}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => handleExport('json')}
                    className="w-full text-left px-3 py-2 text-[13px] text-text-primary hover:bg-surface-2/40 transition-colors duration-150 rounded-lg mx-0"
                  >
                    {t('exportJson')}
                  </button>
                </div>
              )}
            </div>
          )}
          {activeSessionId && (
            <span className="text-[11px] text-text-secondary/40 px-2 py-1 truncate max-w-[200px] font-mono">
              {activeSessionId}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      {messages.length === 0 && !isStreaming ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 animate-[fadeIn_0.4s_ease-out]">
          <div className="w-16 h-16 rounded-[18px] bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center text-2xl font-semibold text-accent shadow-[inset_0_0.5px_0_rgba(255,255,255,0.1)]">
            J
          </div>
          <h2 className="text-[18px] font-semibold tracking-tight">{t('title')}</h2>
          <p className="text-[14px] text-text-secondary text-center max-w-md leading-relaxed">
            {t('emptyDescription')}
          </p>
        </div>
      ) : (
        <MessageList
          messages={messages}
          streamingText={streamingText}
          isStreaming={isStreaming}
          hasMore={hasMoreMessages}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMoreMessages}
        />
      )}

      {/* Confirm dialog for tool calls requiring approval */}
      {pendingConfirm && (
        <div className="px-4 pb-2 animate-[slideUp_0.2s_cubic-bezier(0.2,0.8,0.2,1)]">
          <ConfirmDialog
            action={pendingConfirm}
            onAllow={(alwaysAllow) => resolveConfirm(true, alwaysAllow)}
            onDeny={() => resolveConfirm(false)}
          />
        </div>
      )}

      {/* Input */}
      <InputBox onSend={sendMessage} onAbort={abort} isStreaming={isStreaming} focusKey={activeSessionId} />
    </div>
  );
}

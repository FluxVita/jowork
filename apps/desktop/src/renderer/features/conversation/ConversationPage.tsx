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
      <div className="flex items-center justify-between border-b border-border px-2">
        <EngineIndicator />
        <div className="flex items-center gap-1">
          {activeSessionId && messages.length > 0 && (
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                aria-expanded={showExportMenu}
                aria-haspopup="menu"
                className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 rounded
                  hover:bg-surface-2 transition-colors"
                title={t('exportConversation')}
              >
                {t('export')}
              </button>
              {showExportMenu && (
                <div role="menu" className="absolute right-0 top-full mt-1 bg-surface-2 border border-border rounded-md shadow-lg z-10 py-1 min-w-[140px]">
                  <button
                    role="menuitem"
                    onClick={() => handleExport('markdown')}
                    className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-surface-1 transition-colors"
                  >
                    {t('exportMarkdown')}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => handleExport('json')}
                    className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-surface-1 transition-colors"
                  >
                    {t('exportJson')}
                  </button>
                </div>
              )}
            </div>
          )}
          {activeSessionId && (
            <span className="text-xs text-text-secondary px-2 py-1 truncate max-w-[200px]">
              {activeSessionId}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      {messages.length === 0 && !isStreaming ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center text-2xl">
            J
          </div>
          <h2 className="text-lg font-medium">{t('title')}</h2>
          <p className="text-sm text-text-secondary text-center max-w-md">
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
        <div className="px-4 pb-2">
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

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from './hooks/useChat';
import { MessageList } from './MessageList';
import { InputBox } from './InputBox';
import { EngineIndicator } from './EngineIndicator';
import { ConfirmDialog } from './ConfirmDialog';
import { useConversationStore } from '../../stores/conversation';
import { Bot } from 'lucide-react';

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
      <div className="flex items-center justify-between border-b border-border/20 px-3 py-1 bg-background/5 backdrop-blur-sm z-10">
        <EngineIndicator />
        <div className="flex items-center gap-2">
          {activeSessionId && messages.length > 0 && (
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                aria-expanded={showExportMenu}
                aria-haspopup="menu"
                className="text-[12px] text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-lg
                  hover:bg-surface-2/40 active:scale-[0.97] transition-all duration-200 font-medium"
                title={t('exportConversation')}
              >
                {t('export')}
              </button>
              {showExportMenu && (
                <div role="menu" className="glass-effect absolute right-0 top-full mt-2 rounded-xl z-10 py-1.5 min-w-[150px] animate-in fade-in zoom-in-95 duration-200 border border-border shadow-xl">
                  <button
                    role="menuitem"
                    onClick={() => handleExport('markdown')}
                    className="w-full text-left px-4 py-2 text-[13px] text-foreground hover:bg-primary/10 hover:text-primary transition-colors duration-150"
                  >
                    {t('exportMarkdown')}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => handleExport('json')}
                    className="w-full text-left px-4 py-2 text-[13px] text-foreground hover:bg-primary/10 hover:text-primary transition-colors duration-150"
                  >
                    {t('exportJson')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      {messages.length === 0 && !isStreaming ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="w-20 h-20 rounded-[24px] bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-2xl shadow-primary/20 border border-white/10 relative overflow-hidden">
            <div className="absolute inset-0 bg-white/20 blur-xl rounded-full" />
            <Bot className="w-10 h-10 text-white relative z-10" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h2>
            <p className="text-[15px] text-muted-foreground max-w-md leading-relaxed">
              {t('emptyDescription')}
            </p>
          </div>
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
        <div className="px-4 pb-2 animate-in slide-in-from-bottom-4 duration-300">
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

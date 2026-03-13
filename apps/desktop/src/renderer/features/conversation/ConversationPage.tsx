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
    <div className="flex flex-col h-full w-full relative overflow-hidden">
      {/* Header Bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-surface-1/20 backdrop-blur-md z-30">
        <EngineIndicator />
        <div className="flex items-center gap-3">
          {activeSessionId && messages.length > 0 && (
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="text-[12px] font-bold text-muted-foreground hover:text-primary bg-surface-2/40 px-3 py-1.5 rounded-xl border border-white/5 transition-all active:scale-95"
              >
                {t('export')}
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-2 glass-effect border border-white/10 rounded-2xl z-50 p-1.5 min-w-[160px] shadow-2xl animate-in fade-in zoom-in-95">
                  <button onClick={() => handleExport('markdown')} className="w-full text-left px-4 py-2.5 text-[13px] font-semibold hover:bg-primary hover:text-white rounded-xl transition-colors">{t('exportMarkdown')}</button>
                  <button onClick={() => handleExport('json')} className="w-full text-left px-4 py-2.5 text-[13px] font-semibold hover:bg-primary hover:text-white rounded-xl transition-colors">{t('exportJson')}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <div className="relative mb-8 group">
              <div className="absolute inset-0 bg-primary/30 blur-[60px] rounded-full group-hover:bg-primary/50 transition-all duration-700" />
              <div className="relative w-24 h-24 rounded-[32px] bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-2xl border border-white/20">
                <Bot className="w-12 h-12 text-white" />
              </div>
            </div>
            <h1 className="text-4xl font-black tracking-tight mb-4">{t('title', { defaultValue: 'JoWork AI 助手' })}</h1>
            <p className="text-lg text-muted-foreground max-w-lg leading-relaxed">
              {t('emptyDescription', { defaultValue: '与 AI 助手对话，它可以帮你编码、分析数据等。' })}
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
      </div>

      {/* Confirm dialog */}
      {pendingConfirm && (
        <div className="absolute bottom-[100px] left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-40 animate-in slide-in-from-bottom-4">
          <ConfirmDialog action={pendingConfirm} onAllow={(a) => resolveConfirm(true, a)} onDeny={() => resolveConfirm(false)} />
        </div>
      )}

      {/* Bottom Input Area */}
      <footer className="w-full pb-8 pt-2 px-6 z-30">
        <InputBox onSend={sendMessage} onAbort={abort} isStreaming={isStreaming} focusKey={activeSessionId} />
      </footer>
    </div>
  );
}

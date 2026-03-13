import { useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageBubble } from './MessageBubble';
import { ToolCallCard } from './ToolCallCard';
import { ToolResultCard } from './ToolResultCard';
import { StreamingText } from './StreamingText';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolName?: string;
}

interface MessageListProps {
  messages: Message[];
  streamingText: string;
  isStreaming: boolean;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

function renderMessage(msg: Message): ReactNode {
  switch (msg.role) {
    case 'tool_call':
      return <ToolCallCard toolName={msg.toolName ?? 'tool'} content={msg.content} />;
    case 'tool_result':
      return <ToolResultCard toolName={msg.toolName} content={msg.content} />;
    default:
      return <MessageBubble role={msg.role} content={msg.content} />;
  }
}

export function MessageList({ messages, streamingText, isStreaming, hasMore, isLoadingMore, onLoadMore }: MessageListProps) {
  const { t } = useTranslation('chat');
  const parentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(messages.length);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  // Auto-scroll to bottom only on new messages (not when loading older ones)
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    // Only auto-scroll if messages were appended (not prepended via load-more)
    if (messages.length > prevMessageCount.current) {
      const newCount = messages.length - prevMessageCount.current;
      // If a small number of messages were added, it's likely new messages → scroll down
      // If many were prepended (load more), don't scroll
      if (newCount <= 5) {
        scrollToBottom();
      }
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    if (streamingText) scrollToBottom();
  }, [streamingText, scrollToBottom]);

  // Scroll-to-top detection for loading older messages
  useEffect(() => {
    const el = parentRef.current;
    if (!el || !hasMore || !onLoadMore) return;

    const handleScroll = () => {
      if (el.scrollTop < 100 && !isLoadingMore) {
        onLoadMore();
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [hasMore, isLoadingMore, onLoadMore]);

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto px-4 py-8 custom-scrollbar">
      <div className="max-w-4xl mx-auto">
        {/* Load more indicator */}
        {hasMore && (
          <div className="text-center py-4 mb-4">
            {isLoadingMore ? (
              <span className="text-[13px] text-muted-foreground/60 flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                {t('loadingOlder')}
              </span>
            ) : (
              <button
                onClick={onLoadMore}
                className="text-[13px] text-primary/70 hover:text-primary bg-primary/5 hover:bg-primary/10 px-4 py-1.5 rounded-full transition-colors duration-200"
              >
                {t('loadOlder')}
              </button>
            )}
          </div>
        )}

        {/* Virtualized message list */}
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
            >
              {renderMessage(messages[virtualItem.index])}
            </div>
          ))}
        </div>

        {/* Streaming text (outside virtualizer — always at the bottom) */}
        {isStreaming && streamingText && (
          <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="max-w-[85%] rounded-[24px] rounded-bl-md px-5 py-3.5 glass-effect text-foreground shadow-lg border-border/80">
              <StreamingText text={streamingText} />
            </div>
          </div>
        )}

        {/* Thinking indicator */}
        {isStreaming && !streamingText && (
          <div className="flex items-center gap-3 py-4 pl-2 animate-in fade-in duration-300">
            <div className="flex items-center gap-1.5 p-3 rounded-2xl glass-effect border-border/50">
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '200ms' }} />
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" style={{ animationDelay: '400ms' }} />
            </div>
            <span className="text-[14px] text-muted-foreground/80 font-medium">{t('thinking')}</span>
          </div>
        )}

        <div ref={bottomRef} className="h-4" />
      </div>
    </div>
  );
}

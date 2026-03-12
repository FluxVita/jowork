import { useRef, useEffect, useCallback, type ReactNode } from 'react';
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
    <div ref={parentRef} className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto">
        {/* Load more indicator */}
        {hasMore && (
          <div className="text-center py-2 mb-2">
            {isLoadingMore ? (
              <span className="text-xs text-text-secondary">Loading older messages...</span>
            ) : (
              <button
                onClick={onLoadMore}
                className="text-xs text-accent hover:text-accent/80 transition-colors"
              >
                Load older messages
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
          <div className="mb-4">
            <div className="max-w-[80%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-surface-2">
              <StreamingText text={streamingText} />
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex items-center gap-2 text-sm text-text-secondary py-2">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>Thinking...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

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

export function MessageList({ messages, streamingText, isStreaming }: MessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  // Auto-scroll to bottom on new messages or streaming
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamingText, scrollToBottom]);

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto">
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

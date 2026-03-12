import { useRef, useEffect } from 'react';
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

export function MessageList({ messages, streamingText, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto">
        {messages.map((msg) => {
          switch (msg.role) {
            case 'tool_call':
              return <ToolCallCard key={msg.id} toolName={msg.toolName ?? 'tool'} content={msg.content} />;
            case 'tool_result':
              return <ToolResultCard key={msg.id} toolName={msg.toolName} content={msg.content} />;
            default:
              return <MessageBubble key={msg.id} role={msg.role} content={msg.content} />;
          }
        })}

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

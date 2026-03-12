import { useChat } from './hooks/useChat';
import { MessageList } from './MessageList';
import { InputBox } from './InputBox';
import { EngineIndicator } from './EngineIndicator';
import { ConfirmDialog } from './ConfirmDialog';
import { useConversationStore } from '../../stores/conversation';

export function ConversationPage() {
  const { sendMessage, abort, isStreaming, streamingText, messages } = useChat();
  const activeSessionId = useConversationStore((s) => s.activeSessionId);
  const pendingConfirm = useConversationStore((s) => s.pendingConfirm);
  const resolveConfirm = useConversationStore((s) => s.resolveConfirm);

  return (
    <div className="flex flex-col h-full">
      {/* Engine status bar */}
      <div className="flex items-center justify-between border-b border-border px-2">
        <EngineIndicator />
        {activeSessionId && (
          <span className="text-xs text-text-secondary px-3 py-1 truncate max-w-[200px]">
            {activeSessionId}
          </span>
        )}
      </div>

      {/* Messages */}
      {messages.length === 0 && !isStreaming ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center text-2xl">
            J
          </div>
          <h2 className="text-lg font-medium">JoWork AI Assistant</h2>
          <p className="text-sm text-text-secondary text-center max-w-md">
            Start a conversation with your AI assistant. It can help you with code, analysis, and more.
          </p>
        </div>
      ) : (
        <MessageList
          messages={messages}
          streamingText={streamingText}
          isStreaming={isStreaming}
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
      <InputBox onSend={sendMessage} onAbort={abort} isStreaming={isStreaming} />
    </div>
  );
}

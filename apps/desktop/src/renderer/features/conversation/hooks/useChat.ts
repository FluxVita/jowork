import { useEffect } from 'react';
import { useConversationStore } from '../../../stores/conversation';

/**
 * Sets up IPC listeners for chat events and session creation.
 * Call once at the conversation page level.
 */
export function useChat() {
  const handleChatEvent = useConversationStore((s) => s.handleChatEvent);
  const handleSessionCreated = useConversationStore((s) => s.handleSessionCreated);

  useEffect(() => {
    const offChat = window.jowork.chat.onEvent((data) => {
      handleChatEvent(data as Parameters<typeof handleChatEvent>[0]);
    });
    const offSession = window.jowork.session.onCreated((session) => {
      handleSessionCreated(session as Parameters<typeof handleSessionCreated>[0]);
    });
    return () => {
      offChat();
      offSession();
    };
  }, [handleChatEvent, handleSessionCreated]);

  return {
    sendMessage: useConversationStore((s) => s.sendMessage),
    abort: useConversationStore((s) => s.abort),
    isStreaming: useConversationStore((s) => s.isStreaming),
    streamingText: useConversationStore((s) => s.streamingText),
    messages: useConversationStore((s) => s.messages),
  };
}

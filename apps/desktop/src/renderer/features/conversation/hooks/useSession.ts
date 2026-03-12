import { useEffect } from 'react';
import { useConversationStore } from '../../../stores/conversation';

export function useSession() {
  const loadSessions = useConversationStore((s) => s.loadSessions);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  return {
    sessions: useConversationStore((s) => s.sessions),
    activeSessionId: useConversationStore((s) => s.activeSessionId),
    selectSession: useConversationStore((s) => s.selectSession),
    createSession: useConversationStore((s) => s.createSession),
    deleteSession: useConversationStore((s) => s.deleteSession),
    renameSession: useConversationStore((s) => s.renameSession),
  };
}

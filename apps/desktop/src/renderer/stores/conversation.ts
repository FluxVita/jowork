import { create } from 'zustand';

let _msgSeq = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_msgSeq}`;
}

interface Session {
  id: string;
  title: string;
  engineId: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  mode: string;
}

interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolName?: string;
  tokens?: number;
  cost?: number;
  createdAt: string;
}

interface ChatEvent {
  sessionId: string;
  type: string;
  content?: string;
  toolName?: string;
  input?: string;
  result?: string;
  message?: string;
  confirmAction?: 'auto' | 'confirm' | 'block';
  confirmRisk?: 'low' | 'medium' | 'high';
}

export interface PendingConfirm {
  toolName: string;
  description: string;
  params: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
}

interface ConversationStore {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingText: string;
  pendingConfirm: PendingConfirm | null;
  hasMoreMessages: boolean;
  isLoadingMore: boolean;

  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  createSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  abort: () => Promise<void>;
  handleChatEvent: (event: ChatEvent) => void;
  handleSessionCreated: (session: Session) => void;
  resolveConfirm: (allowed: boolean, alwaysAllow?: boolean) => void;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  isStreaming: false,
  streamingText: '',
  pendingConfirm: null,
  hasMoreMessages: false,
  isLoadingMore: false,

  loadSessions: async () => {
    const sessions = await window.jowork.session.list();
    set({ sessions });
  },

  selectSession: async (id) => {
    set({ activeSessionId: id, messages: [], streamingText: '', hasMoreMessages: false });
    const data = await window.jowork.session.get(id);
    if (data) {
      set({ messages: data.messages ?? [], hasMoreMessages: data.hasMore ?? false });
    }
  },

  loadMoreMessages: async () => {
    const { activeSessionId, messages, isLoadingMore, hasMoreMessages } = get();
    if (!activeSessionId || isLoadingMore || !hasMoreMessages) return;

    const oldestMsg = messages[0];
    if (!oldestMsg) return;

    set({ isLoadingMore: true });
    try {
      const result = await window.jowork.session.messages(activeSessionId, {
        limit: 40,
        beforeId: oldestMsg.id,
      });
      set((s) => ({
        messages: [...(result.messages as Message[]), ...s.messages],
        hasMoreMessages: result.hasMore,
        isLoadingMore: false,
      }));
    } catch {
      set({ isLoadingMore: false });
    }
  },

  createSession: async () => {
    const session = await window.jowork.session.create();
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: session.id,
      messages: [],
      streamingText: '',
    }));
  },

  deleteSession: async (id) => {
    const { activeSessionId, isStreaming } = get();
    // Abort streaming if deleting the active session
    if (activeSessionId === id && isStreaming) {
      await window.jowork.chat.abort().catch(() => {});
    }
    await window.jowork.session.delete(id);
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== id);
      return {
        sessions,
        activeSessionId: activeSessionId === id ? (sessions[0]?.id ?? null) : activeSessionId,
        messages: activeSessionId === id ? [] : s.messages,
        isStreaming: activeSessionId === id ? false : s.isStreaming,
        streamingText: activeSessionId === id ? '' : s.streamingText,
      };
    });
  },

  renameSession: async (id, title) => {
    await window.jowork.session.rename(id, title);
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, title } : sess)),
    }));
  },

  sendMessage: async (content) => {
    const { activeSessionId } = get();
    set((s) => ({
      isStreaming: true,
      streamingText: '',
      messages: [
        ...s.messages,
        {
          id: uniqueId('tmp'),
          sessionId: activeSessionId ?? '',
          role: 'user' as const,
          content,
          createdAt: new Date().toISOString(),
        },
      ],
    }));

    try {
      const result = await window.jowork.chat.send({
        sessionId: activeSessionId ?? undefined,
        message: content,
      });

      // If a new session was created, update activeSessionId
      if (!activeSessionId && result.sessionId) {
        set({ activeSessionId: result.sessionId });
      }
    } catch (err) {
      console.error('Chat error:', err);
    } finally {
      // Finalize streaming: convert streamingText to a real message
      const { streamingText, activeSessionId: sid } = get();
      if (streamingText) {
        set((s) => ({
          isStreaming: false,
          messages: [
            ...s.messages,
            {
              id: uniqueId('msg'),
              sessionId: sid ?? '',
              role: 'assistant' as const,
              content: streamingText,
              createdAt: new Date().toISOString(),
            },
          ],
          streamingText: '',
        }));
      } else {
        set({ isStreaming: false });
      }
    }
  },

  abort: async () => {
    await window.jowork.chat.abort();
    set({ isStreaming: false, pendingConfirm: null, streamingText: '' });
  },

  handleChatEvent: (event) => {
    // Ignore events from a different session
    const { activeSessionId } = get();
    if (event.sessionId && activeSessionId && event.sessionId !== activeSessionId) return;

    switch (event.type) {
      case 'text':
        if (event.content) {
          set((s) => ({ streamingText: s.streamingText + event.content }));
        }
        break;
      case 'tool_use':
        // If confirm required, show dialog
        if (event.confirmAction === 'confirm') {
          let params: Record<string, unknown> = {};
          try {
            params = event.input ? JSON.parse(event.input) : {};
          } catch {
            params = { raw: event.input };
          }
          set({
            pendingConfirm: {
              toolName: event.toolName ?? 'unknown',
              description: `Tool call: ${event.toolName}`,
              params,
              risk: event.confirmRisk ?? 'medium',
            },
          });
        }
        // Always add to messages for visibility
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: uniqueId('tc'),
              sessionId: event.sessionId,
              role: 'tool_call' as const,
              content: event.input ?? '',
              toolName: event.toolName,
              createdAt: new Date().toISOString(),
            },
          ],
        }));
        break;
      case 'tool_result':
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: uniqueId('tr'),
              sessionId: event.sessionId,
              role: 'tool_result' as const,
              content: event.result ?? '',
              toolName: event.toolName,
              createdAt: new Date().toISOString(),
            },
          ],
        }));
        break;
      case 'error':
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: uniqueId('err'),
              sessionId: event.sessionId,
              role: 'system' as const,
              content: `Error: ${event.message}`,
              createdAt: new Date().toISOString(),
            },
          ],
          isStreaming: false,
        }));
        break;
    }
  },

  handleSessionCreated: (session) => {
    set((s) => ({
      sessions: [session, ...s.sessions.filter((sess) => sess.id !== session.id)],
      activeSessionId: session.id,
    }));
  },

  resolveConfirm: (allowed, alwaysAllow) => {
    const { pendingConfirm } = get();
    if (!pendingConfirm) return;

    // Send the decision back to the main process so the engine can proceed
    window.jowork.confirm.evaluate(pendingConfirm.toolName).catch(() => {});
    if (allowed && alwaysAllow) {
      window.jowork.confirm.alwaysAllow(pendingConfirm.toolName);
    }

    set({ pendingConfirm: null });
  },
}));

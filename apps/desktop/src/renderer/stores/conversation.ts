import { create } from 'zustand';

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
}

interface ConversationStore {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingText: string;

  loadSessions: () => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  createSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  abort: () => Promise<void>;
  handleChatEvent: (event: ChatEvent) => void;
  handleSessionCreated: (session: Session) => void;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  isStreaming: false,
  streamingText: '',

  loadSessions: async () => {
    const sessions = await window.jowork.session.list();
    set({ sessions });
  },

  selectSession: async (id) => {
    set({ activeSessionId: id, messages: [], streamingText: '' });
    const data = await window.jowork.session.get(id);
    if (data) {
      set({ messages: data.messages ?? [] });
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
    await window.jowork.session.delete(id);
    const { activeSessionId } = get();
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== id);
      return {
        sessions,
        activeSessionId: activeSessionId === id ? (sessions[0]?.id ?? null) : activeSessionId,
        messages: activeSessionId === id ? [] : s.messages,
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
          id: `tmp-${Date.now()}`,
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
              id: `msg-${Date.now()}`,
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
    set({ isStreaming: false });
  },

  handleChatEvent: (event) => {
    switch (event.type) {
      case 'text':
        if (event.content) {
          set((s) => ({ streamingText: s.streamingText + event.content }));
        }
        break;
      case 'tool_call':
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: `tc-${Date.now()}`,
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
              id: `tr-${Date.now()}`,
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
              id: `err-${Date.now()}`,
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
}));

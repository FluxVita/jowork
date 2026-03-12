import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HistoryManager } from '../main/engine/history';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DB = join(tmpdir(), `jowork-test-history-${Date.now()}.db`);

describe('HistoryManager', () => {
  let hm: HistoryManager;

  beforeEach(() => {
    hm = new HistoryManager(TEST_DB);
  });

  afterEach(() => {
    hm.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    // Also remove WAL/SHM files
    if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal');
    if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm');
  });

  describe('Session CRUD', () => {
    it('creates a session with auto-generated ID', () => {
      const session = hm.createSession('claude-code', 'Test conversation');
      expect(session.id).toMatch(/^ses_/);
      expect(session.title).toBe('Test conversation');
      expect(session.engineId).toBe('claude-code');
      expect(session.mode).toBe('personal');
      expect(session.messageCount).toBe(0);
    });

    it('uses default title when none provided', () => {
      const session = hm.createSession('claude-code');
      expect(session.title).toBe('New Conversation');
    });

    it('retrieves session by ID', () => {
      const created = hm.createSession('claude-code', 'My session');
      const found = hm.getSession(created.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('My session');
    });

    it('returns null for non-existent session', () => {
      expect(hm.getSession('nonexistent')).toBeNull();
    });

    it('lists sessions in reverse chronological order', async () => {
      hm.createSession('claude-code', 'First');
      await new Promise((r) => setTimeout(r, 5));
      hm.createSession('openclaw', 'Second');
      await new Promise((r) => setTimeout(r, 5));
      hm.createSession('claude-code', 'Third');

      const list = hm.listSessions();
      expect(list.length).toBe(3);
      expect(list[0].title).toBe('Third');
      expect(list[2].title).toBe('First');
    });

    it('respects limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        hm.createSession('claude-code', `Session ${i}`);
      }
      const page = hm.listSessions({ limit: 3, offset: 2 });
      expect(page.length).toBe(3);
    });

    it('renames a session', () => {
      const session = hm.createSession('claude-code', 'Original');
      hm.renameSession(session.id, 'Renamed');
      const found = hm.getSession(session.id);
      expect(found!.title).toBe('Renamed');
    });

    it('deletes a session and its messages', () => {
      const session = hm.createSession('claude-code', 'ToDelete');
      hm.appendMessage(session.id, { sessionId: session.id, role: 'user', content: 'Hi' });

      hm.deleteSession(session.id);
      expect(hm.getSession(session.id)).toBeNull();
      expect(hm.getMessages(session.id)).toHaveLength(0);
    });
  });

  describe('Messages', () => {
    it('appends messages and increments count', () => {
      const session = hm.createSession('claude-code', 'Chat');
      const msg = hm.appendMessage(session.id, {
        sessionId: session.id,
        role: 'user',
        content: 'Hello world',
      });

      expect(msg.id).toMatch(/^msg_/);
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello world');

      // Session count should be updated
      const updated = hm.getSession(session.id);
      expect(updated!.messageCount).toBe(1);
    });

    it('stores multiple messages in order', () => {
      const session = hm.createSession('claude-code');
      hm.appendMessage(session.id, { sessionId: session.id, role: 'user', content: 'Q1' });
      hm.appendMessage(session.id, { sessionId: session.id, role: 'assistant', content: 'A1' });
      hm.appendMessage(session.id, { sessionId: session.id, role: 'user', content: 'Q2' });

      const msgs = hm.getMessages(session.id);
      expect(msgs).toHaveLength(3);
      expect(msgs[0].content).toBe('Q1');
      expect(msgs[1].content).toBe('A1');
      expect(msgs[2].content).toBe('Q2');

      const s = hm.getSession(session.id);
      expect(s!.messageCount).toBe(3);
    });

    it('stores optional fields (toolName, tokens, cost)', () => {
      const session = hm.createSession('claude-code');
      const msg = hm.appendMessage(session.id, {
        sessionId: session.id,
        role: 'assistant',
        content: 'Tool result',
        toolName: 'read_file',
        tokens: 150,
        cost: 5,
      });
      expect(msg.toolName).toBe('read_file');
      expect(msg.tokens).toBe(150);
      expect(msg.cost).toBe(5);
    });

    it('paginates messages with getMessagesPaginated', () => {
      const session = hm.createSession('claude-code');
      // Insert 10 messages
      for (let i = 1; i <= 10; i++) {
        hm.appendMessage(session.id, { sessionId: session.id, role: 'user', content: `msg-${i}` });
      }

      // Load last 3 messages
      const page1 = hm.getMessagesPaginated(session.id, { limit: 3 });
      expect(page1.messages).toHaveLength(3);
      expect(page1.hasMore).toBe(true);
      expect(page1.messages[0].content).toBe('msg-8');
      expect(page1.messages[2].content).toBe('msg-10');

      // Load next 3 (before the oldest in page1)
      const page2 = hm.getMessagesPaginated(session.id, { limit: 3, beforeId: page1.messages[0].id });
      expect(page2.messages).toHaveLength(3);
      expect(page2.hasMore).toBe(true);
      expect(page2.messages[0].content).toBe('msg-5');
      expect(page2.messages[2].content).toBe('msg-7');

      // Load remaining
      const page3 = hm.getMessagesPaginated(session.id, { limit: 10, beforeId: page2.messages[0].id });
      expect(page3.messages).toHaveLength(4);
      expect(page3.hasMore).toBe(false);
      expect(page3.messages[0].content).toBe('msg-1');
    });
  });

  describe('Engine session mappings', () => {
    it('binds and retrieves engine session ID', () => {
      const session = hm.createSession('claude-code');
      hm.bindEngineSession(session.id, 'claude-code', 'cc_abc123');

      const engineSessionId = hm.getEngineSessionId(session.id, 'claude-code');
      expect(engineSessionId).toBe('cc_abc123');
    });

    it('returns null for unmapped engine', () => {
      const session = hm.createSession('claude-code');
      expect(hm.getEngineSessionId(session.id, 'openclaw')).toBeNull();
    });

    it('updates on conflict (same session+engine)', () => {
      const session = hm.createSession('claude-code');
      hm.bindEngineSession(session.id, 'claude-code', 'old_id');
      hm.bindEngineSession(session.id, 'claude-code', 'new_id');

      expect(hm.getEngineSessionId(session.id, 'claude-code')).toBe('new_id');
    });
  });

  describe('Settings', () => {
    it('sets and gets a setting', () => {
      hm.setSetting('theme', 'dark');
      expect(hm.getSetting('theme')).toBe('dark');
    });

    it('returns null for missing setting', () => {
      expect(hm.getSetting('nonexistent')).toBeNull();
    });

    it('overwrites on same key', () => {
      hm.setSetting('lang', 'en');
      hm.setSetting('lang', 'zh');
      expect(hm.getSetting('lang')).toBe('zh');
    });
  });

  describe('Context rebuild', () => {
    it('rebuilds context from messages', () => {
      const session = hm.createSession('claude-code');
      hm.appendMessage(session.id, { sessionId: session.id, role: 'user', content: 'Q1' });
      hm.appendMessage(session.id, { sessionId: session.id, role: 'assistant', content: 'A1' });

      const ctx = hm.rebuildContextForEngine(session.id);
      expect(ctx).toContain('user: Q1');
      expect(ctx).toContain('assistant: A1');
    });
  });

  describe('SQLite instance', () => {
    it('exposes sqlite instance for sharing', () => {
      const sqlite = hm.getSqliteInstance();
      expect(sqlite).toBeDefined();
      // Should be able to run a query
      const result = sqlite.prepare('SELECT 1 as n').get() as { n: number };
      expect(result.n).toBe(1);
    });
  });
});

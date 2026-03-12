/**
 * End-to-end desktop backend flow tests.
 * Simulates a user's complete journey through the desktop app's backend
 * (HistoryManager, MemoryStore, ModeManager, Settings).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { HistoryManager } from '../main/engine/history';
import { MemoryStore } from '../main/memory/store';
import { ModeManager } from '../main/auth/mode';
import { ContextDocsStore } from '../main/context/docs';
import { OfflineQueue } from '../main/sync/offline-queue';
import { Scheduler } from '../main/scheduler/index';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DB = join(tmpdir(), `jowork-e2e-flow-${Date.now()}.db`);

describe('E2E: Desktop user journey', () => {
  let hm: HistoryManager;
  let memStore: MemoryStore;
  let modeManager: ModeManager;
  let contextDocs: ContextDocsStore;
  let offlineQueue: OfflineQueue;
  let scheduler: Scheduler;

  beforeAll(() => {
    hm = new HistoryManager(TEST_DB);
    const sqlite = hm.getSqliteInstance();
    memStore = new MemoryStore(sqlite);
    contextDocs = new ContextDocsStore(sqlite);
    offlineQueue = new OfflineQueue(sqlite);
    scheduler = new Scheduler(sqlite);
    modeManager = new ModeManager(
      (key) => hm.getSetting(key),
      (key, value) => hm.setSetting(key, value),
    );
  });

  afterAll(() => {
    hm.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal');
    if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm');
  });

  // ==========================================
  // FLOW 1: First launch (Personal mode)
  // ==========================================
  describe('Flow 1: First launch in Personal mode', () => {
    it('Step 1: App starts in personal mode, no login required', () => {
      const state = modeManager.getState();
      expect(state.mode).toBe('personal');
      expect(state.localUserId).toMatch(/^local_/);
      expect(modeManager.isPersonal()).toBe(true);
      expect(modeManager.isLoggedIn()).toBe(false);
    });

    it('Step 2: User sees empty session list', () => {
      const sessions = hm.listSessions();
      expect(sessions).toHaveLength(0);
    });

    it('Step 3: No memories exist initially', () => {
      const memories = memStore.list();
      expect(memories).toHaveLength(0);
    });
  });

  // ==========================================
  // FLOW 2: First conversation
  // ==========================================
  describe('Flow 2: User starts a conversation', () => {
    let sessionId: string;

    it('Step 1: Create a new session', () => {
      const session = hm.createSession('claude-code', 'My first question');
      sessionId = session.id;
      expect(session.title).toBe('My first question');
      expect(session.engineId).toBe('claude-code');
    });

    it('Step 2: User sends a message', () => {
      const msg = hm.appendMessage(sessionId, {
        sessionId,
        role: 'user',
        content: 'How do I write a React component?',
      });
      expect(msg.role).toBe('user');
    });

    it('Step 3: Engine responds', () => {
      const msg = hm.appendMessage(sessionId, {
        sessionId,
        role: 'assistant',
        content: 'Here is how you create a React component: ...',
        tokens: 250,
        cost: 10,
      });
      expect(msg.tokens).toBe(250);
    });

    it('Step 4: Session shows 2 messages', () => {
      const session = hm.getSession(sessionId);
      expect(session!.messageCount).toBe(2);
    });

    it('Step 5: Message history is correct', () => {
      const msgs = hm.getMessages(sessionId);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe('user');
      expect(msgs[1].role).toBe('assistant');
    });

    it('Step 6: Engine session binding works', () => {
      hm.bindEngineSession(sessionId, 'claude-code', 'cc_session_xyz');
      const engineSid = hm.getEngineSessionId(sessionId, 'claude-code');
      expect(engineSid).toBe('cc_session_xyz');
    });

    it('Step 7: Session appears in list', () => {
      const list = hm.listSessions();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(sessionId);
    });
  });

  // ==========================================
  // FLOW 3: Memory management
  // ==========================================
  describe('Flow 3: User manages memories', () => {
    let memId: string;

    it('Step 1: Create a memory', () => {
      const mem = memStore.create({
        title: 'Preferred code style',
        content: 'Use functional components with hooks',
        tags: ['react', 'code-style'],
        scope: 'personal',
        pinned: true,
      });
      memId = mem.id;
      expect(mem.pinned).toBe(true);
      expect(mem.tags).toEqual(['react', 'code-style']);
    });

    it('Step 2: Create more memories', () => {
      memStore.create({ title: 'API endpoint', content: 'Backend is at localhost:3000', tags: ['api'] });
      memStore.create({ title: 'DB password', content: 'postgres://...', scope: 'personal', tags: ['secret'] });
    });

    it('Step 3: List all memories (3 total)', () => {
      const all = memStore.list();
      expect(all).toHaveLength(3);
    });

    it('Step 4: Filter pinned memories', () => {
      const pinned = memStore.list({ pinned: true });
      expect(pinned).toHaveLength(1);
      expect(pinned[0].title).toBe('Preferred code style');
    });

    it('Step 5: Search memories', () => {
      const results = memStore.search('react');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('code style');
    });

    it('Step 6: Update a memory', () => {
      const updated = memStore.update(memId, {
        content: 'Use functional components with hooks, prefer TypeScript',
      });
      expect(updated!.content).toContain('TypeScript');
    });

    it('Step 7: Touch used updates timestamp', () => {
      const before = memStore.get(memId)!.lastUsedAt;
      memStore.touchUsed(memId);
      const after = memStore.get(memId)!.lastUsedAt;
      expect(after).toBeGreaterThan(before ?? 0);
    });

    it('Step 8: Delete a memory', () => {
      memStore.delete(memId);
      expect(memStore.get(memId)).toBeNull();
      expect(memStore.list()).toHaveLength(2);
    });
  });

  // ==========================================
  // FLOW 4: Settings management
  // ==========================================
  describe('Flow 4: User configures settings', () => {
    it('Step 1: Set theme preference', () => {
      hm.setSetting('theme', 'dark');
      expect(hm.getSetting('theme')).toBe('dark');
    });

    it('Step 2: Set language preference', () => {
      hm.setSetting('language', 'zh');
      expect(hm.getSetting('language')).toBe('zh');
    });

    it('Step 3: Change theme', () => {
      hm.setSetting('theme', 'light');
      expect(hm.getSetting('theme')).toBe('light');
    });

    it('Step 4: Settings persist across reads', () => {
      expect(hm.getSetting('language')).toBe('zh');
      expect(hm.getSetting('theme')).toBe('light');
    });
  });

  // ==========================================
  // FLOW 5: Mode switching (Personal → Team)
  // ==========================================
  describe('Flow 5: Mode switching', () => {
    it('Step 1: User logs in (simulate cloud auth)', () => {
      modeManager.setCloudUser('cloud_user_aiden');
      expect(modeManager.isLoggedIn()).toBe(true);
      expect(modeManager.getEffectiveUserId()).toBe('cloud_user_aiden');
    });

    it('Step 2: User switches to Team mode', () => {
      modeManager.switchToTeam('team_fluxvita', 'FluxVita');
      expect(modeManager.isTeam()).toBe(true);
      const state = modeManager.getState();
      expect(state.teamId).toBe('team_fluxvita');
      expect(state.teamName).toBe('FluxVita');
    });

    it('Step 3: Settings persist mode state', () => {
      expect(hm.getSetting('app_mode')).toBe('team');
      expect(hm.getSetting('team_id')).toBe('team_fluxvita');
      expect(hm.getSetting('team_name')).toBe('FluxVita');
    });

    it('Step 4: User switches back to Personal', () => {
      modeManager.switchToPersonal();
      expect(modeManager.isPersonal()).toBe(true);
      expect(modeManager.getState().teamId).toBeUndefined();
    });

    it('Step 5: Mode reverts to personal on logout', () => {
      modeManager.setCloudUser('cloud_user_aiden');
      modeManager.switchToTeam('team_x', 'TeamX');
      modeManager.clearCloudUser(); // logout
      expect(modeManager.isPersonal()).toBe(true);
      expect(modeManager.isLoggedIn()).toBe(false);
    });
  });

  // ==========================================
  // FLOW 6: Multiple conversations
  // ==========================================
  describe('Flow 6: Multiple conversations', () => {
    it('Step 1: Create multiple sessions', async () => {
      hm.createSession('claude-code', 'React help');
      await new Promise((r) => setTimeout(r, 5));
      hm.createSession('openclaw', 'Python question');
      await new Promise((r) => setTimeout(r, 5));
      hm.createSession('claude-code', 'Latest session');
    });

    it('Step 2: Sessions are ordered by recency', () => {
      const sessions = hm.listSessions();
      // Last created should be first
      expect(sessions[0].title).toBe('Latest session');
    });

    it('Step 3: Rename a session', () => {
      const sessions = hm.listSessions();
      hm.renameSession(sessions[0].id, 'Renamed: Latest');
      const updated = hm.getSession(sessions[0].id);
      expect(updated!.title).toBe('Renamed: Latest');
    });

    it('Step 4: Delete a session', () => {
      const sessions = hm.listSessions();
      const countBefore = sessions.length;
      hm.deleteSession(sessions[sessions.length - 1].id);
      const countAfter = hm.listSessions().length;
      expect(countAfter).toBe(countBefore - 1);
    });
  });

  // ==========================================
  // FLOW 7: Context rebuild
  // ==========================================
  describe('Flow 7: Context rebuild for engine switching', () => {
    it('Rebuilds conversation context from history', () => {
      const session = hm.createSession('claude-code', 'Context test');
      hm.appendMessage(session.id, { sessionId: session.id, role: 'user', content: 'What is TypeScript?' });
      hm.appendMessage(session.id, { sessionId: session.id, role: 'assistant', content: 'TypeScript is...' });

      const context = hm.rebuildContextForEngine(session.id);
      expect(context).toContain('user: What is TypeScript?');
      expect(context).toContain('assistant: TypeScript is...');
    });
  });

  // ==========================================
  // FLOW 8: Context docs management
  // ==========================================
  describe('Flow 8: Context docs CRUD', () => {
    let docId: string;

    it('Step 1: Create a context doc', () => {
      const doc = contextDocs.create({
        title: 'Team coding standards',
        content: 'Use TypeScript strict mode',
        scope: 'team',
        category: 'code',
        priority: 10,
      });
      docId = doc.id;
      expect(doc.scope).toBe('team');
      expect(doc.priority).toBe(10);
    });

    it('Step 2: List context docs by scope', () => {
      contextDocs.create({ title: 'Personal note', content: 'My style', scope: 'personal' });
      const teamDocs = contextDocs.listByScope('team');
      expect(teamDocs.length).toBeGreaterThanOrEqual(1);
      expect(teamDocs.every((d) => d.scope === 'team')).toBe(true);
    });

    it('Step 3: Update a context doc', () => {
      const updated = contextDocs.update(docId, { content: 'Use TypeScript strict mode + ESLint' });
      expect(updated!.content).toContain('ESLint');
    });

    it('Step 4: Delete a context doc', () => {
      contextDocs.delete(docId);
      expect(contextDocs.get(docId)).toBeNull();
    });
  });

  // ==========================================
  // FLOW 9: Offline sync queue
  // ==========================================
  describe('Flow 9: Offline sync queue', () => {
    it('Step 1: Queue starts empty', () => {
      expect(offlineQueue.count()).toBe(0);
    });

    it('Step 2: Enqueue sync records', () => {
      offlineQueue.enqueue({
        id: 'mem_1', entity: 'memory', data: { title: 'Test' },
        syncVersion: 1, updatedAt: Date.now(),
      });
      offlineQueue.enqueue({
        id: 'mem_2', entity: 'memory', data: { title: 'Test 2' },
        syncVersion: 1, updatedAt: Date.now(),
      });
      expect(offlineQueue.count()).toBe(2);
    });

    it('Step 3: Deduplicate on re-enqueue', () => {
      offlineQueue.enqueue({
        id: 'mem_1', entity: 'memory', data: { title: 'Updated' },
        syncVersion: 2, updatedAt: Date.now(),
      });
      expect(offlineQueue.count()).toBe(2); // Still 2, not 3
    });

    it('Step 4: Drain returns FIFO order', () => {
      const records = offlineQueue.drain();
      expect(records).toHaveLength(2);
      expect(records[0].id).toBe('mem_1');
      expect(records[0].data.title).toBe('Updated'); // Deduped version
    });

    it('Step 5: Remove after successful push', () => {
      offlineQueue.remove(['mem_1']);
      expect(offlineQueue.count()).toBe(1);
    });

    it('Step 6: Clear all', () => {
      offlineQueue.clear();
      expect(offlineQueue.count()).toBe(0);
    });
  });

  // ==========================================
  // FLOW 10: Scheduler task management
  // ==========================================
  describe('Flow 10: Scheduler CRUD', () => {
    let taskId: string;

    it('Step 1: Create a scheduled task', () => {
      const task = scheduler.create({
        name: 'Daily scan',
        cronExpression: '0 9 * * *',
        type: 'scan',
        config: { connectorId: 'github' },
      });
      taskId = task.id;
      expect(task.name).toBe('Daily scan');
      expect(task.enabled).toBe(true);
      expect(task.timezone).toBe('Asia/Shanghai');
    });

    it('Step 2: List tasks', () => {
      const tasks = scheduler.list();
      expect(tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('Step 3: Update a task', () => {
      const updated = scheduler.update(taskId, { enabled: false });
      expect(updated!.enabled).toBe(false);
    });

    it('Step 4: Get a task by id', () => {
      const task = scheduler.get(taskId);
      expect(task).not.toBeNull();
      expect(task!.enabled).toBe(false);
    });

    it('Step 5: Delete a task', () => {
      scheduler.delete(taskId);
      expect(scheduler.get(taskId)).toBeNull();
    });
  });

  // ==========================================
  // FLOW 11: Shared SQLite verification
  // ==========================================
  describe('Flow 11: Shared SQLite verification', () => {
    it('All modules share the same database', () => {
      const session = hm.createSession('claude-code', 'Shared DB test');
      const memory = memStore.create({ title: 'Shared test', content: 'Works' });

      expect(hm.getSession(session.id)).not.toBeNull();
      expect(memStore.get(memory.id)).not.toBeNull();

      const sqlite = hm.getSqliteInstance();
      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('messages');
      expect(tableNames).toContain('memories');
      expect(tableNames).toContain('settings');
      expect(tableNames).toContain('context_docs');
      expect(tableNames).toContain('sync_queue');
      expect(tableNames).toContain('scheduled_tasks');
      expect(tableNames).toContain('task_executions');
    });

    it('WAL mode is enabled', () => {
      const sqlite = hm.getSqliteInstance();
      const row = sqlite.pragma('journal_mode') as { journal_mode: string }[];
      expect(row[0].journal_mode).toBe('wal');
    });

    it('Indexes exist for performance', () => {
      const sqlite = hm.getSqliteInstance();
      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain('idx_messages_session');
      expect(indexNames).toContain('idx_sessions_updated');
      expect(indexNames).toContain('idx_memories_scope');
      expect(indexNames).toContain('idx_context_docs_scope');
      expect(indexNames).toContain('idx_sync_queue_created');
      expect(indexNames).toContain('idx_task_executions_task');
    });
  });
});

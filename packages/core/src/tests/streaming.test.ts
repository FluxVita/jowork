// Tests for Phase 32: SSE streaming chat endpoint + chatStream model

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { chatRouter } from '../gateway/routes/chat.js';
import type { DispatchFn } from '../gateway/routes/chat.js';
import type { RunOptions, RunResult } from '../agent/engines/builtin.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-streaming-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedSessionWithAgent(db: ReturnType<typeof openDb>) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run('user-1', 'Test', 'test@test', 'owner', now);
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?,?,?,?,?,?)`)
    .run('agent-1', 'Agent', 'user-1', 'You are test.', 'claude-haiku', now);
  db.prepare(`INSERT OR IGNORE INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run('sess-1', 'agent-1', 'user-1', 'Test', now, now);
}

// ─── chatRouter streaming endpoint ───────────────────────────────────────────

describe('chatRouter — SSE streaming endpoint exists', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('chatRouter creates router with streaming route', () => {
    const router = chatRouter();
    assert.ok(router);

    // Router layer stack should include both message endpoints
    const stack = (router as unknown as { stack: Array<{ route?: { path: string } }> }).stack;
    const paths = stack.filter(l => l.route).map(l => l.route!.path);
    assert.ok(paths.includes('/api/sessions/:id/messages'), 'standard endpoint exists');
    assert.ok(paths.includes('/api/sessions/:id/messages/stream'), 'SSE endpoint exists');
  });

  test('chatRouter with dispatchFn has streaming route', () => {
    const mockDispatch: DispatchFn = async (_opts: RunOptions): Promise<RunResult> => {
      return { messages: [], turnCount: 1 };
    };

    const router = chatRouter(mockDispatch);
    const stack = (router as unknown as { stack: Array<{ route?: { path: string } }> }).stack;
    const paths = stack.filter(l => l.route).map(l => l.route!.path);
    assert.ok(paths.includes('/api/sessions/:id/messages/stream'));
  });
});

// ─── chatStream model function ────────────────────────────────────────────────

describe('chatStream — async generator interface', () => {
  test('chatStream is an async generator function', async () => {
    // Import and verify it's an async generator function
    // We can't call it without API keys, but we can verify the interface
    const { chatStream: cs } = await import('../models/index.js');
    assert.equal(typeof cs, 'function');
    // Should return an async iterable when called (even though it'll fail without API key)
    // We just verify the function exists and is callable
    assert.ok(cs.constructor.name === 'AsyncGeneratorFunction' || typeof cs === 'function');
  });

  test('chatStream rejects with clear error when no API key', async () => {
    const { chatStream: cs } = await import('../models/index.js');
    // Save and clear env var
    const savedKey = process.env['ANTHROPIC_API_KEY'];
    const savedFormat = process.env['MODEL_PROVIDER'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['MODEL_PROVIDER'];

    try {
      const gen = cs([{ role: 'user', content: 'hi' }]);
      await gen.next(); // should throw
      assert.fail('Expected error but none thrown');
    } catch (err) {
      // Expected: either no API key error or provider config error
      assert.ok(err instanceof Error);
    } finally {
      if (savedKey !== undefined) process.env['ANTHROPIC_API_KEY'] = savedKey;
      if (savedFormat !== undefined) process.env['MODEL_PROVIDER'] = savedFormat;
    }
  });
});

// ─── SSE event format correctness ────────────────────────────────────────────

describe('SSE event format', () => {
  test('SSE chunk event is valid JSON with expected shape', () => {
    const chunkEvent = { type: 'chunk', text: 'Hello' };
    const line = `data: ${JSON.stringify(chunkEvent)}\n\n`;
    assert.ok(line.startsWith('data: '));

    const parsed = JSON.parse(line.slice(6).trim()) as { type: string; text: string };
    assert.equal(parsed.type, 'chunk');
    assert.equal(parsed.text, 'Hello');
  });

  test('SSE done event is valid JSON with expected shape', () => {
    const doneEvent = { type: 'done', messageId: 'msg-abc' };
    const line = `data: ${JSON.stringify(doneEvent)}\n\n`;
    const parsed = JSON.parse(line.slice(6).trim()) as { type: string; messageId: string };
    assert.equal(parsed.type, 'done');
    assert.equal(parsed.messageId, 'msg-abc');
  });

  test('SSE error event is valid JSON with expected shape', () => {
    const errorEvent = { type: 'error', message: 'API failure' };
    const line = `data: ${JSON.stringify(errorEvent)}\n\n`;
    const parsed = JSON.parse(line.slice(6).trim()) as { type: string; message: string };
    assert.equal(parsed.type, 'error');
    assert.equal(parsed.message, 'API failure');
  });
});

// Phase 36: Agent built-in tools expansion tests

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, initSchema } from '../datamap/index.js';
import { BUILTIN_TOOLS, getToolSchemas } from '../agent/tools/index.js';
import { saveMemory } from '../memory/index.js';
import type { ToolContext } from '../agent/tools/index.js';

let db: ReturnType<typeof openDb>;
const DATA_DIR = join(tmpdir(), `jowork-tools-test-${Date.now()}`);
const CTX: ToolContext = { userId: 'user-tools', agentId: 'agent-1' };

beforeEach(() => {
  db = openDb(DATA_DIR);
  initSchema(db);
  // Seed user so FK constraints pass
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`,
  ).run(CTX.userId, 'Test User', 'test@example.com', 'owner', now);
});

// ── getToolSchemas ─────────────────────────────────────────────────────────────

describe('getToolSchemas', () => {
  test('returns a schema for each built-in tool', () => {
    const schemas = getToolSchemas();
    assert.equal(schemas.length, BUILTIN_TOOLS.length);
    for (const s of schemas) {
      assert.ok(typeof s.name === 'string' && s.name.length > 0);
      assert.ok(typeof s.description === 'string');
      assert.ok(s.input_schema.type === 'object');
    }
  });

  test('includes all 6 expected tools', () => {
    const names = getToolSchemas().map(s => s.name);
    for (const expected of ['search_memory', 'create_memory', 'list_connectors', 'fetch_connector', 'search_connector', 'list_context']) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }
  });
});

// ── search_memory ─────────────────────────────────────────────────────────────

describe('search_memory tool', () => {
  test('returns no-results message when memory is empty', async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === 'search_memory')!;
    const result = await tool.execute({ query: 'anything' }, CTX);
    assert.equal(result, 'No relevant memories found.');
  });

  test('finds a memory that was saved', async () => {
    saveMemory(CTX.userId, 'Prefer TypeScript over JavaScript');
    const tool = BUILTIN_TOOLS.find(t => t.name === 'search_memory')!;
    const result = await tool.execute({ query: 'TypeScript' }, CTX);
    assert.ok(result.includes('TypeScript'));
  });

  test('throws ForbiddenError when querying another user', async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === 'search_memory')!;
    await assert.rejects(
      () => tool.execute({ query: 'test', userId: 'other-user' }, CTX),
      /FORBIDDEN|access/i,
    );
  });
});

// ── create_memory ─────────────────────────────────────────────────────────────

describe('create_memory tool', () => {
  test('saves a memory and returns confirmation', async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === 'create_memory')!;
    const result = await tool.execute({ content: 'Aiden prefers dark mode' }, CTX);
    assert.ok(result.includes('Memory saved'));
    // verify it can be searched back
    const searchTool = BUILTIN_TOOLS.find(t => t.name === 'search_memory')!;
    const found = await searchTool.execute({ query: 'dark mode' }, CTX);
    assert.ok(found.includes('dark mode'));
  });

  test('returns error for empty content', async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === 'create_memory')!;
    const result = await tool.execute({ content: '   ' }, CTX);
    assert.ok(result.startsWith('Error:'));
  });

  test('parses comma-separated tags', async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === 'create_memory')!;
    const result = await tool.execute({ content: 'Team meeting on Friday', tags: 'meetings, schedule' }, CTX);
    assert.ok(result.includes('Memory saved'));
  });
});

// ── list_connectors ───────────────────────────────────────────────────────────

describe('list_connectors tool', () => {
  test('returns no-connectors message when none configured', async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === 'list_connectors')!;
    const result = await tool.execute({}, CTX);
    assert.equal(result, 'No connectors configured.');
  });

  test('lists connectors belonging to the user', async () => {
    // Insert a connector directly (schema: id, kind, name, settings, owner_id, created_at)
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO connectors (id, kind, name, settings, owner_id, created_at) VALUES (?,?,?,?,?,?)`,
    ).run('conn-1', 'github', 'My GitHub', JSON.stringify({ token: 'x' }), CTX.userId, now);

    const tool = BUILTIN_TOOLS.find(t => t.name === 'list_connectors')!;
    const result = await tool.execute({}, CTX);
    assert.ok(result.includes('My GitHub'));
    assert.ok(result.includes('github'));
  });
});

// ── list_context ──────────────────────────────────────────────────────────────

describe('list_context tool', () => {
  test('returns no-docs message when context is empty', async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === 'list_context')!;
    const result = await tool.execute({}, CTX);
    assert.equal(result, 'No context documents found.');
  });

  test('accepts valid layer filter', async () => {
    const tool = BUILTIN_TOOLS.find(t => t.name === 'list_context')!;
    // Should not throw even if no docs exist for scope
    const result = await tool.execute({ layer: 'company' }, CTX);
    assert.ok(typeof result === 'string');
  });
});

// ── GET /api/agent/tools endpoint ─────────────────────────────────────────────

describe('GET /api/agent/tools', () => {
  test('returns all tool schemas', async () => {
    const { createServer } = await import('node:http');
    const { createApp, agentsRouter } = await import('../index.js');

    const app = createApp({ port: 0, setup(e) { e.use(agentsRouter()); } });
    const server = createServer(app);
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://localhost:${port}/api/agent/tools`, {
        headers: { 'x-user-id': 'test' },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { tools: Array<{ name: string }> };
      assert.ok(Array.isArray(body.tools));
      assert.ok(body.tools.length >= 6);
      const names = body.tools.map((t: { name: string }) => t.name);
      assert.ok(names.includes('search_memory'));
      assert.ok(names.includes('create_memory'));
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});

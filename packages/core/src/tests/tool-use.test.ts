// Phase 37: Anthropic native tool_use API tests

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, initSchema } from '../datamap/index.js';
import type { ApiMessage, ToolSchema, ChatWithToolsResponse } from '../models/index.js';

const DATA_DIR = join(tmpdir(), `jowork-tooluse-test-${Date.now()}`);

beforeEach(() => {
  const db = openDb(DATA_DIR);
  initSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`,
  ).run('user-tu', 'Tool User', 'tu@example.com', 'owner', now);
});

// ── ApiMessage type structure ─────────────────────────────────────────────────

describe('ApiMessage type', () => {
  test('accepts string content', () => {
    const msg: ApiMessage = { role: 'user', content: 'Hello' };
    assert.equal(msg.content, 'Hello');
  });

  test('accepts structured content array', () => {
    const msg: ApiMessage = {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'result' }],
    };
    assert.ok(Array.isArray(msg.content));
  });
});

// ── ToolSchema type structure ─────────────────────────────────────────────────

describe('ToolSchema type', () => {
  test('matches expected shape', () => {
    const schema: ToolSchema = {
      name: 'test_tool',
      description: 'A test tool',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Query text' } },
        required: ['query'],
      },
    };
    assert.equal(schema.input_schema.type, 'object');
    assert.ok(schema.input_schema.properties['query']);
  });
});

// ── chatWithTools() with mocked fetch ─────────────────────────────────────────

describe('chatWithTools()', () => {
  const TOOLS: ToolSchema[] = [{
    name: 'search_memory',
    description: 'Search memory',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Query' } }, required: ['query'] },
  }];

  test('returns text and empty toolCalls when no tool_use in response', async () => {
    // Mock fetch to return an Anthropic-style response with only text content
    const mockFetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Hello, I can help you.' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    // Set up env for Anthropic
    const origApiKey = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    const origProvider = process.env['MODEL_PROVIDER'];
    process.env['MODEL_PROVIDER'] = 'anthropic';

    try {
      const { chatWithTools } = await import('../models/index.js');
      const messages: ApiMessage[] = [{ role: 'user', content: 'Hello' }];
      const resp: ChatWithToolsResponse = await chatWithTools(messages, TOOLS);
      assert.equal(resp.text, 'Hello, I can help you.');
      assert.equal(resp.toolCalls.length, 0);
      assert.equal(resp.inputTokens, 10);
      assert.equal(resp.outputTokens, 20);
    } finally {
      globalThis.fetch = origFetch;
      if (origApiKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = origApiKey;
      if (origProvider === undefined) delete process.env['MODEL_PROVIDER'];
      else process.env['MODEL_PROVIDER'] = origProvider;
    }
  });

  test('returns toolCalls when tool_use blocks are present', async () => {
    const mockFetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [
          { type: 'text', text: 'Let me search for that.' },
          { type: 'tool_use', id: 'toolu_123', name: 'search_memory', input: { query: 'TypeScript' } },
        ],
        usage: { input_tokens: 15, output_tokens: 25 },
      }),
    }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const origApiKey = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    const origProvider = process.env['MODEL_PROVIDER'];
    process.env['MODEL_PROVIDER'] = 'anthropic';

    try {
      const { chatWithTools } = await import('../models/index.js');
      const messages: ApiMessage[] = [{ role: 'user', content: 'Find TypeScript memories' }];
      const resp = await chatWithTools(messages, TOOLS);
      assert.equal(resp.text, 'Let me search for that.');
      assert.equal(resp.toolCalls.length, 1);
      assert.equal(resp.toolCalls[0]!.id, 'toolu_123');
      assert.equal(resp.toolCalls[0]!.name, 'search_memory');
      assert.deepEqual(resp.toolCalls[0]!.input, { query: 'TypeScript' });
    } finally {
      globalThis.fetch = origFetch;
      if (origApiKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = origApiKey;
      if (origProvider === undefined) delete process.env['MODEL_PROVIDER'];
      else process.env['MODEL_PROVIDER'] = origProvider;
    }
  });

  test('throws on non-ok response', async () => {
    const mockFetch = mock.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const origApiKey = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'bad-key';
    const origProvider = process.env['MODEL_PROVIDER'];
    process.env['MODEL_PROVIDER'] = 'anthropic';

    try {
      const { chatWithTools } = await import('../models/index.js');
      await assert.rejects(
        () => chatWithTools([{ role: 'user', content: 'Hi' }], []),
        /401/,
      );
    } finally {
      globalThis.fetch = origFetch;
      if (origApiKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = origApiKey;
      if (origProvider === undefined) delete process.env['MODEL_PROVIDER'];
      else process.env['MODEL_PROVIDER'] = origProvider;
    }
  });

  test('missing API key throws', async () => {
    const origApiKey = process.env['ANTHROPIC_API_KEY'];
    const origProvider = process.env['MODEL_PROVIDER'];
    delete process.env['ANTHROPIC_API_KEY'];
    process.env['MODEL_PROVIDER'] = 'anthropic';

    try {
      const { chatWithTools } = await import('../models/index.js');
      await assert.rejects(
        () => chatWithTools([{ role: 'user', content: 'Hi' }], []),
        /ANTHROPIC_API_KEY/,
      );
    } finally {
      if (origApiKey !== undefined) process.env['ANTHROPIC_API_KEY'] = origApiKey;
      if (origProvider === undefined) delete process.env['MODEL_PROVIDER'];
      else process.env['MODEL_PROVIDER'] = origProvider;
    }
  });
});

// ── runBuiltin() with mocked chatWithTools ────────────────────────────────────

describe('runBuiltin() native tool_use loop', () => {
  const SESSION_ID = 'sess-tu-1';
  const AGENT_ID   = 'agent-tu-1';
  const USER_ID    = 'user-tu';

  beforeEach(() => {
    const db = openDb(DATA_DIR);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO agents (id, name, system_prompt, owner_id, created_at) VALUES (?,?,?,?,?)`,
    ).run(AGENT_ID, 'Test Agent', 'You are helpful.', USER_ID, now);
    db.prepare(
      `INSERT OR IGNORE INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    ).run(SESSION_ID, AGENT_ID, USER_ID, 'Test', now, now);
  });

  test('completes when no tool calls are returned', async () => {
    // Patch chatWithTools to return plain text
    const origEnv = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    const origProvider = process.env['MODEL_PROVIDER'];
    process.env['MODEL_PROVIDER'] = 'anthropic';

    const mockFetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Done!' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const { runBuiltin } = await import('../agent/engines/builtin.js');
      const result = await runBuiltin({
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        userId: USER_ID,
        systemPrompt: 'You are helpful.',
        history: [],
        userMessage: 'Hello',
      });
      // Should have exactly 2 messages: user + assistant
      assert.equal(result.messages.length, 2);
      assert.equal(result.messages[0]!.role, 'user');
      assert.equal(result.messages[1]!.role, 'assistant');
      assert.equal(result.messages[1]!.content, 'Done!');
      assert.equal(result.turnCount, 1);
    } finally {
      globalThis.fetch = origFetch;
      if (origEnv === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = origEnv;
      if (origProvider === undefined) delete process.env['MODEL_PROVIDER'];
      else process.env['MODEL_PROVIDER'] = origProvider;
    }
  });

  test('executes tool and continues when tool_use block returned', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['MODEL_PROVIDER'] = 'anthropic';

    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // First turn: return a tool_use block
        return {
          ok: true,
          json: async () => ({
            content: [
              { type: 'tool_use', id: 'tu_abc', name: 'search_memory', input: { query: 'test' } },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        };
      }
      // Second turn: return plain text (done)
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'I found the memory.' }],
          usage: { input_tokens: 20, output_tokens: 10 },
        }),
      };
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const { runBuiltin } = await import('../agent/engines/builtin.js');
      const result = await runBuiltin({
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        userId: USER_ID,
        systemPrompt: 'You are helpful.',
        history: [],
        userMessage: 'Search my memory',
      });
      // Should have called fetch twice (2 turns)
      assert.equal(callCount, 2);
      assert.equal(result.turnCount, 2);
      // Final message should be the assistant text
      const assistantMsg = result.messages.find(m => m.role === 'assistant');
      assert.ok(assistantMsg);
      assert.equal(assistantMsg.content, 'I found the memory.');
    } finally {
      globalThis.fetch = origFetch;
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['MODEL_PROVIDER'];
    }
  });

  test('stops at BUILTIN_MAX_TURNS if tools keep firing', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['MODEL_PROVIDER'] = 'anthropic';

    // Always return a tool_use block — infinite loop scenario
    const mockFetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [
          { type: 'tool_use', id: 'tu_loop', name: 'search_memory', input: { query: 'x' } },
        ],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const { runBuiltin, BUILTIN_MAX_TURNS } = await import('../agent/engines/builtin.js');
      const result = await runBuiltin({
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        userId: USER_ID,
        systemPrompt: 'You are helpful.',
        history: [],
        userMessage: 'Loop test',
      });
      // Should stop at max turns
      assert.equal(result.turnCount, BUILTIN_MAX_TURNS);
    } finally {
      globalThis.fetch = origFetch;
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['MODEL_PROVIDER'];
    }
  });

  test('calls onChunk for each turn text', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['MODEL_PROVIDER'] = 'anthropic';

    const mockFetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'chunk text' }],
        usage: { input_tokens: 5, output_tokens: 5 },
      }),
    }));
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const chunks: string[] = [];
    try {
      const { runBuiltin } = await import('../agent/engines/builtin.js');
      await runBuiltin({
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        userId: USER_ID,
        systemPrompt: 'You are helpful.',
        history: [],
        userMessage: 'Test chunks',
        onChunk: (t) => { chunks.push(t); },
      });
      assert.ok(chunks.length > 0);
      assert.ok(chunks.some(c => c.includes('chunk text')));
    } finally {
      globalThis.fetch = origFetch;
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['MODEL_PROVIDER'];
    }
  });
});

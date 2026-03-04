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

// ── SSE stream helpers for runBuiltin() tests ────────────────────────────────

const enc2 = new TextEncoder();

function makeStreamBody(events: string[]): ReadableStream<Uint8Array> {
  const payload = events.join('');
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc2.encode(payload));
      controller.close();
    },
  });
}

function textStreamBody(text: string): ReadableStream<Uint8Array> {
  return makeStreamBody([
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
    `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  ]);
}

function toolUseStreamBody(id: string, name: string, inputJson: string): ReadableStream<Uint8Array> {
  return makeStreamBody([
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: inputJson } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
    `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  ]);
}

// ── runBuiltin() with streaming mocks ────────────────────────────────────────

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
    const origEnv = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    const origProvider = process.env['MODEL_PROVIDER'];
    process.env['MODEL_PROVIDER'] = 'anthropic';

    const origFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({ ok: true, body: textStreamBody('Done!') })) as unknown as typeof fetch;

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
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: true, body: toolUseStreamBody('tu_abc', 'search_memory', '{"query":"test"}') };
      }
      return { ok: true, body: textStreamBody('I found the memory.') };
    }) as unknown as typeof fetch;

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
      assert.equal(callCount, 2);
      assert.equal(result.turnCount, 2);
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

    const origFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      body: toolUseStreamBody('tu_loop', 'search_memory', '{"query":"x"}'),
    })) as unknown as typeof fetch;

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

    const origFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({ ok: true, body: textStreamBody('chunk text') })) as unknown as typeof fetch;

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

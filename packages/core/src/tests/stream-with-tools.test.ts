// Phase 38: streamWithTools() and agent-aware streaming tests

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, initSchema } from '../datamap/index.js';

const DATA_DIR = join(tmpdir(), `jowork-stream-tools-test-${Date.now()}`);

beforeEach(() => {
  const db = openDb(DATA_DIR);
  initSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`,
  ).run('user-st', 'Stream Tools User', 'st@example.com', 'owner', now);
});

// ─── Helper: build a fake Anthropic SSE stream body ──────────────────────────

function makeTextSSE(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const events = [
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
    `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  ].join('');

  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(events));
      controller.close();
    },
  });
}

function makeToolUseSSE(id: string, name: string, inputJson: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const events = [
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: inputJson } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
    `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  ].join('');

  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(events));
      controller.close();
    },
  });
}

function makeTextAndToolSSE(text: string, toolId: string, toolName: string, toolInput: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const events = [
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: toolId, name: toolName, input: {} } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: toolInput } })}\n\n`,
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 1 })}\n\n`,
    `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  ].join('');

  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(events));
      controller.close();
    },
  });
}

// ─── streamWithTools() tests ──────────────────────────────────────────────────

describe('streamWithTools()', () => {
  test('yields chunk events for text-only response', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      body: makeTextSSE('Hello world'),
    })) as unknown as typeof fetch;

    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['MODEL_PROVIDER'] = 'anthropic';

    try {
      const { streamWithTools } = await import('../models/index.js');
      const chunks: string[] = [];
      const tools: string[] = [];
      for await (const evt of streamWithTools([{ role: 'user', content: 'Hi' }], [])) {
        if (evt.type === 'chunk') chunks.push(evt.text);
        else tools.push(evt.tool.name);
      }
      assert.ok(chunks.join('').includes('Hello world'));
      assert.equal(tools.length, 0);
    } finally {
      globalThis.fetch = origFetch;
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['MODEL_PROVIDER'];
    }
  });

  test('yields tool_complete event for tool_use response', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      body: makeToolUseSSE('toolu_abc', 'search_memory', '{"query":"TypeScript"}'),
    })) as unknown as typeof fetch;

    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['MODEL_PROVIDER'] = 'anthropic';

    try {
      const { streamWithTools } = await import('../models/index.js');
      const events: Array<{ type: string }> = [];
      for await (const evt of streamWithTools([{ role: 'user', content: 'Find stuff' }], [])) {
        events.push(evt);
      }
      const toolEvents = events.filter(e => e.type === 'tool_complete');
      assert.equal(toolEvents.length, 1);
      const te = toolEvents[0] as { type: 'tool_complete'; tool: { id: string; name: string; input: Record<string, unknown> } };
      assert.equal(te.tool.id, 'toolu_abc');
      assert.equal(te.tool.name, 'search_memory');
      assert.deepEqual(te.tool.input, { query: 'TypeScript' });
    } finally {
      globalThis.fetch = origFetch;
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['MODEL_PROVIDER'];
    }
  });

  test('yields both chunk and tool_complete for mixed response', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      body: makeTextAndToolSSE('Let me look.', 'tu_1', 'search_memory', '{"query":"test"}'),
    })) as unknown as typeof fetch;

    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['MODEL_PROVIDER'] = 'anthropic';

    try {
      const { streamWithTools } = await import('../models/index.js');
      const textParts: string[] = [];
      const toolNames: string[] = [];
      for await (const evt of streamWithTools([{ role: 'user', content: 'Search' }], [])) {
        if (evt.type === 'chunk') textParts.push(evt.text);
        else toolNames.push(evt.tool.name);
      }
      assert.ok(textParts.join('').includes('Let me look.'));
      assert.ok(toolNames.includes('search_memory'));
    } finally {
      globalThis.fetch = origFetch;
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['MODEL_PROVIDER'];
    }
  });

  test('throws on non-ok response', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal error',
    })) as unknown as typeof fetch;

    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['MODEL_PROVIDER'] = 'anthropic';

    try {
      const { streamWithTools } = await import('../models/index.js');
      await assert.rejects(async () => {
        for await (const _ of streamWithTools([{ role: 'user', content: 'Hi' }], [])) { /* noop */ }
      }, /500/);
    } finally {
      globalThis.fetch = origFetch;
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['MODEL_PROVIDER'];
    }
  });
});

// ─── runBuiltin() streaming tests ─────────────────────────────────────────────

describe('runBuiltin() streaming via streamWithTools', () => {
  const SESSION_ID = 'sess-sw-1';
  const AGENT_ID   = 'agent-sw-1';
  const USER_ID    = 'user-st';

  beforeEach(() => {
    const db = openDb(DATA_DIR);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR IGNORE INTO agents (id, name, system_prompt, owner_id, created_at) VALUES (?,?,?,?,?)`,
    ).run(AGENT_ID, 'Stream Agent', 'You are helpful.', USER_ID, now);
    db.prepare(
      `INSERT OR IGNORE INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    ).run(SESSION_ID, AGENT_ID, USER_ID, 'Stream Test', now, now);
  });

  test('onChunk receives individual text chunks', async () => {
    const origFetch = globalThis.fetch;
    // Simulate streaming two separate text_delta events
    const enc = new TextEncoder();
    const events = [
      `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'World' } })}\n\n`,
      `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
      `data: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
    ].join('');

    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(enc.encode(events));
          controller.close();
        },
      }),
    })) as unknown as typeof fetch;

    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    process.env['MODEL_PROVIDER'] = 'anthropic';

    const chunks: string[] = [];
    try {
      const { runBuiltin } = await import('../agent/engines/builtin.js');
      const result = await runBuiltin({
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        userId: USER_ID,
        systemPrompt: 'Be helpful.',
        history: [],
        userMessage: 'Hi',
        onChunk: (t) => { chunks.push(t); },
      });
      // Should receive both text deltas as separate onChunk calls
      assert.ok(chunks.length >= 1);
      assert.equal(chunks.join(''), 'Hello World');
      // Final stored message should have full text
      const assistantMsg = result.messages.find(m => m.role === 'assistant');
      assert.equal(assistantMsg?.content, 'Hello World');
    } finally {
      globalThis.fetch = origFetch;
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['MODEL_PROVIDER'];
    }
  });
});

// Phase 35: OpenAI-compatible streaming + Ollama auto-discovery tests

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock fetch globally ────────────────────────────────────────────────────────

// Helpers to build a mock ReadableStream that emits SSE lines
function makeOpenAIStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        const payload = { choices: [{ delta: { content: chunk }, finish_reason: null }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function makeAnthropicStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        const evt = { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
      }
      controller.close();
    },
  });
}

// ── discoverOllamaModels tests ─────────────────────────────────────────────────

describe('discoverOllamaModels', () => {
  test('returns empty array when Ollama is not running', async () => {
    const origFetch = global.fetch;
    global.fetch = mock.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    try {
      const { discoverOllamaModels } = await import('../models/index.js');
      const models = await discoverOllamaModels();
      assert.deepEqual(models, []);
    } finally {
      global.fetch = origFetch;
    }
  });

  test('returns model names when Ollama responds', async () => {
    const origFetch = global.fetch;
    global.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2', size: 1 }, { name: 'mistral', size: 2 }] }),
    })) as unknown as typeof fetch;
    try {
      const { discoverOllamaModels } = await import('../models/index.js');
      const models = await discoverOllamaModels();
      assert.deepEqual(models, ['llama3.2', 'mistral']);
    } finally {
      global.fetch = origFetch;
    }
  });

  test('returns empty array when Ollama returns non-ok response', async () => {
    const origFetch = global.fetch;
    global.fetch = mock.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    try {
      const { discoverOllamaModels } = await import('../models/index.js');
      const models = await discoverOllamaModels();
      assert.deepEqual(models, []);
    } finally {
      global.fetch = origFetch;
    }
  });
});

// ── chatStream OpenAI-compatible tests ────────────────────────────────────────

describe('chatStream — OpenAI-compatible (Ollama)', () => {
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    origEnv = { ...process.env };
    process.env['MODEL_PROVIDER'] = 'ollama';
    process.env['MODEL_NAME'] = 'llama3.2';
    // Ollama doesn't need an API key
    delete process.env['API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
  });

  function restoreEnv() {
    for (const k of Object.keys(process.env)) {
      if (!(k in origEnv)) delete process.env[k];
    }
    Object.assign(process.env, origEnv);
  }

  test('yields text chunks from OpenAI SSE stream', async () => {
    const origFetch = global.fetch;
    global.fetch = mock.fn(async () => ({
      ok: true,
      body: makeOpenAIStream(['Hello', ' world', '!']),
    })) as unknown as typeof fetch;

    try {
      const { chatStream } = await import('../models/index.js');
      const chunks: string[] = [];
      for await (const chunk of chatStream([{ role: 'user', content: 'Hi' }])) {
        chunks.push(chunk);
      }
      assert.deepEqual(chunks, ['Hello', ' world', '!']);
    } finally {
      global.fetch = origFetch;
      restoreEnv();
    }
  });

  test('throws on non-ok response', async () => {
    const origFetch = global.fetch;
    global.fetch = mock.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    })) as unknown as typeof fetch;

    try {
      const { chatStream } = await import('../models/index.js');
      const gen = chatStream([{ role: 'user', content: 'Hi' }]);
      await assert.rejects(async () => {
        for await (const _ of gen) { /* consume */ }
      }, /503/);
    } finally {
      global.fetch = origFetch;
      restoreEnv();
    }
  });

  test('handles empty delta content gracefully', async () => {
    const origFetch = global.fetch;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        // chunk with no content field
        ctrl.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":null}]}\n\n'));
        ctrl.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n'));
        ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
        ctrl.close();
      },
    });
    global.fetch = mock.fn(async () => ({ ok: true, body: stream })) as unknown as typeof fetch;

    try {
      const { chatStream } = await import('../models/index.js');
      const chunks: string[] = [];
      for await (const chunk of chatStream([{ role: 'user', content: 'test' }])) {
        chunks.push(chunk);
      }
      assert.deepEqual(chunks, ['ok']);
    } finally {
      global.fetch = origFetch;
      restoreEnv();
    }
  });
});

// ── modelsRouter endpoint tests ────────────────────────────────────────────────

describe('/api/models endpoints', () => {
  test('GET /api/models/providers returns built-in providers', async () => {
    const { createServer } = await import('node:http');
    const { createApp, modelsRouter } = await import('../index.js');

    const app = createApp({ port: 0, setup(e) { e.use(modelsRouter()); } });
    const server = createServer(app);

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://localhost:${port}/api/models/providers`, {
        headers: { 'x-user-id': 'test' },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { providers: Array<{ id: string }> };
      const ids = body.providers.map(p => p.id);
      assert.ok(ids.includes('anthropic'));
      assert.ok(ids.includes('openai'));
      assert.ok(ids.includes('ollama'));
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test('GET /api/models/active returns current provider from env', async () => {
    const saved = process.env['MODEL_PROVIDER'];
    process.env['MODEL_PROVIDER'] = 'ollama';
    const { createServer } = await import('node:http');
    const { createApp, modelsRouter } = await import('../index.js');

    const app = createApp({ port: 0, setup(e) { e.use(modelsRouter()); } });
    const server = createServer(app);

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://localhost:${port}/api/models/active`, {
        headers: { 'x-user-id': 'test' },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { provider: string };
      assert.equal(body.provider, 'ollama');
    } finally {
      process.env['MODEL_PROVIDER'] = saved;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test('GET /api/models/ollama/discover returns correct shape', async () => {
    const { createServer } = await import('node:http');
    const { createApp, modelsRouter } = await import('../index.js');

    const app = createApp({ port: 0, setup(e) { e.use(modelsRouter()); } });
    const server = createServer(app);

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://localhost:${port}/api/models/ollama/discover`, {
        headers: { 'x-user-id': 'test' },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { available: boolean; models: string[] };
      assert.ok(typeof body.available === 'boolean');
      assert.ok(Array.isArray(body.models));
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test('PUT /api/models/active switches provider and model', async () => {
    const savedProvider = process.env['MODEL_PROVIDER'];
    const savedModel    = process.env['MODEL_NAME'];
    const { createServer } = await import('node:http');
    const { createApp, modelsRouter } = await import('../index.js');

    const app = createApp({ port: 0, setup(e) { e.use(modelsRouter()); } });
    const server = createServer(app);

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://localhost:${port}/api/models/active`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-user-id': 'test' },
        body: JSON.stringify({ provider: 'openai', model: 'gpt-4o' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { provider: string; model: string; apiFormat: string };
      assert.equal(body.provider, 'openai');
      assert.equal(body.model, 'gpt-4o');
      assert.equal(body.apiFormat, 'openai');
      assert.equal(process.env['MODEL_PROVIDER'], 'openai');
      assert.equal(process.env['MODEL_NAME'], 'gpt-4o');
    } finally {
      process.env['MODEL_PROVIDER'] = savedProvider;
      process.env['MODEL_NAME']     = savedModel;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test('PUT /api/models/active rejects unknown provider', async () => {
    const { createServer } = await import('node:http');
    const { createApp, modelsRouter } = await import('../index.js');

    const app = createApp({ port: 0, setup(e) { e.use(modelsRouter()); } });
    const server = createServer(app);

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://localhost:${port}/api/models/active`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-user-id': 'test' },
        body: JSON.stringify({ provider: 'unknown-xyz', model: 'some-model' }),
      });
      assert.equal(res.status, 400);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test('PUT /api/models/active rejects missing fields', async () => {
    const { createServer } = await import('node:http');
    const { createApp, modelsRouter } = await import('../index.js');

    const app = createApp({ port: 0, setup(e) { e.use(modelsRouter()); } });
    const server = createServer(app);

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const res = await fetch(`http://localhost:${port}/api/models/active`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-user-id': 'test' },
        body: JSON.stringify({ provider: 'anthropic' }),
      });
      assert.equal(res.status, 400);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

// Discord channel tests — Phase 25
// Tests: initialization, webhook send, bot send, rich card, onMessage, shutdown

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { discordChannel } from '../channels/discord.js';
import type { RichCard, ChannelTarget, IncomingMessage } from '../channels/protocol.js';

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

type FetchBody = {
  content?: string;
  embeds?: unknown[];
};

let lastFetchUrl  = '';
let lastFetchBody: FetchBody | null = null;
let fetchResponse: { ok: boolean; status: number; body: unknown } = { ok: true, status: 204, body: null };

const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
  lastFetchUrl  = url.toString();
  lastFetchBody = init?.body ? JSON.parse(init.body as string) as FetchBody : null;
  return {
    ok:     fetchResponse.ok,
    status: fetchResponse.status,
    text:   async () => JSON.stringify(fetchResponse.body),
    json:   async () => fetchResponse.body,
  } as Response;
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Discord channel — initialization', () => {
  afterEach(async () => { await discordChannel.shutdown(); });

  test('throws if neither webhookUrl nor botToken provided', async () => {
    await assert.rejects(
      () => discordChannel.initialize({}),
      /webhookUrl or botToken/,
    );
  });

  test('initializes with webhookUrl', async () => {
    await assert.doesNotReject(
      () => discordChannel.initialize({ webhookUrl: 'https://discord.com/api/webhooks/123/abc' }),
    );
  });

  test('initializes with botToken (no channelId — no polling started)', async () => {
    await assert.doesNotReject(
      () => discordChannel.initialize({ botToken: 'Bot.test.token' }),
    );
  });
});

describe('Discord channel — metadata', () => {
  test('id is discord', () => { assert.equal(discordChannel.id, 'discord'); });
  test('name is Discord', () => { assert.equal(discordChannel.name, 'Discord'); });
  test('supports rich cards', () => { assert.equal(discordChannel.capabilities.richCards, true); });
  test('does not support file upload (YAGNI)', () => { assert.equal(discordChannel.capabilities.fileUpload, false); });
});

describe('Discord channel — sendText via webhook', () => {
  const webhookUrl = 'https://discord.com/api/webhooks/999/xyz';
  const target: ChannelTarget = { id: '', type: 'channel' };

  beforeEach(async () => {
    global.fetch = mockFetch as typeof fetch;
    fetchResponse = { ok: true, status: 204, body: null };
    lastFetchUrl  = '';
    lastFetchBody = null;
    await discordChannel.initialize({ webhookUrl });
  });

  afterEach(async () => { await discordChannel.shutdown(); });

  test('posts to webhook URL', async () => {
    await discordChannel.sendText(target, 'Hello Discord!');
    assert.equal(lastFetchUrl, webhookUrl);
    assert.equal(lastFetchBody?.content, 'Hello Discord!');
  });

  test('throws on non-ok webhook response', async () => {
    fetchResponse = { ok: false, status: 400, body: 'Bad Request' };
    await assert.rejects(
      () => discordChannel.sendText(target, 'oops'),
      /webhook error 400/,
    );
  });
});

describe('Discord channel — sendRichCard via webhook', () => {
  const webhookUrl = 'https://discord.com/api/webhooks/888/rich';
  const target: ChannelTarget = { id: '', type: 'channel' };

  const card: RichCard = {
    title:  'Task completed',
    body:   'The scheduled job finished successfully.',
    footer: 'Jowork Agent',
    color:  '#5865F2',
    fields: [
      { label: 'Duration', value: '2m 30s', inline: true },
      { label: 'Status',   value: 'OK',     inline: true },
    ],
  };

  beforeEach(async () => {
    global.fetch = mockFetch as typeof fetch;
    fetchResponse = { ok: true, status: 204, body: null };
    lastFetchUrl  = '';
    lastFetchBody = null;
    await discordChannel.initialize({ webhookUrl });
  });

  afterEach(async () => { await discordChannel.shutdown(); });

  test('posts embeds to webhook', async () => {
    await discordChannel.sendRichCard!(target, card);
    assert.equal(lastFetchUrl, webhookUrl);
    assert.ok(Array.isArray(lastFetchBody?.embeds), 'embeds should be array');
    assert.equal((lastFetchBody?.embeds as unknown[])?.length, 1);
  });

  test('embed contains title and description', async () => {
    await discordChannel.sendRichCard!(target, card);
    const embed = (lastFetchBody?.embeds as Array<{ title?: string; description?: string }>)?.[0];
    assert.equal(embed?.title, 'Task completed');
    assert.equal(embed?.description, card.body);
  });

  test('embed color converts hex to integer', async () => {
    await discordChannel.sendRichCard!(target, card);
    const embed = (lastFetchBody?.embeds as Array<{ color?: number }>)?.[0];
    // #5865F2 = 5793266
    assert.equal(embed?.color, 0x5865f2);
  });
});

describe('Discord channel — onMessage handler registration', () => {
  afterEach(async () => { await discordChannel.shutdown(); });

  test('onMessage stores handler (no-op in webhook mode)', async () => {
    global.fetch = mockFetch as typeof fetch;
    await discordChannel.initialize({ webhookUrl: 'https://discord.com/api/webhooks/1/1' });

    let called = false;
    discordChannel.onMessage(async (_msg: IncomingMessage) => { called = true; });

    // In webhook mode no messages arrive — handler should not be auto-called
    await new Promise(r => setTimeout(r, 20));
    assert.equal(called, false, 'handler should not be called in webhook-only mode');
  });
});

describe('Discord channel — bot mode polling', () => {
  afterEach(async () => { await discordChannel.shutdown(); });

  test('initializes in bot mode without throwing', async () => {
    global.fetch = mockFetch as typeof fetch;
    fetchResponse = { ok: true, status: 200, body: [] };
    await assert.doesNotReject(() =>
      discordChannel.initialize({
        botToken:  'Bot.valid.token',
        channelId: '12345',
      }),
    );
  });

  test('poll skips bot messages to avoid echo loops', async () => {
    const botMessage = {
      id: '999',
      content: 'I am a bot',
      author: { id: 'bot-id', username: 'Jowork', bot: true },
      channel_id: '12345',
      timestamp: new Date().toISOString(),
    };
    fetchResponse = { ok: true, status: 200, body: [botMessage] };
    global.fetch = mockFetch as typeof fetch;

    let received = false;
    discordChannel.onMessage(async () => { received = true; });

    await discordChannel.initialize({ botToken: 'Bot.x', channelId: '12345' });
    // Wait briefly for first poll tick
    await new Promise(r => setTimeout(r, 6000));
    await discordChannel.shutdown();

    assert.equal(received, false, 'bot messages should be skipped');
  });

  test('poll delivers human messages to handler', async () => {
    const humanMessage = {
      id: '1001',
      content: 'Hello from Discord!',
      author: { id: 'user-1', username: 'Alice', bot: false },
      channel_id: '12345',
      timestamp: new Date().toISOString(),
    };
    fetchResponse = { ok: true, status: 200, body: [humanMessage] };
    global.fetch = mockFetch as typeof fetch;

    let receivedText = '';
    discordChannel.onMessage(async (msg: IncomingMessage) => { receivedText = msg.text; });

    await discordChannel.initialize({ botToken: 'Bot.y', channelId: '12345' });
    await new Promise(r => setTimeout(r, 6000));
    await discordChannel.shutdown();

    assert.equal(receivedText, 'Hello from Discord!');
  });
});

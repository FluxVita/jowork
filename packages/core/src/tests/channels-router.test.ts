// Channels router tests — Phase 26
// Tests: channel registry state helpers, protocol layer, auto-registration

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerChannelPlugin,
  getChannelPlugin,
  listChannelPlugins,
  markChannelInitialized,
  markChannelShutdown,
  isChannelInitialized,
} from '../channels/protocol.js';
import type { JoworkChannel, ChannelConfig, ChannelTarget, IncomingMessage, ChannelCapabilities } from '../channels/protocol.js';

// ─── Minimal stub channel for testing ─────────────────────────────────────────

function makeStubChannel(id: string): JoworkChannel & { initCount: number; shutdownCount: number } {
  return {
    id,
    name: `Stub-${id}`,
    capabilities: {
      richCards:   false,
      fileUpload:  false,
      reactions:   false,
      threads:     false,
      editMessage: false,
    } satisfies ChannelCapabilities,
    initCount:     0,
    shutdownCount: 0,
    async initialize(_config: ChannelConfig) { this.initCount++; },
    async shutdown()                          { this.shutdownCount++; },
    onMessage(_h: (m: IncomingMessage) => Promise<void>) { /* no-op */ },
    async sendText(_t: ChannelTarget, _text: string)     { /* no-op */ },
  };
}

// ─── Protocol registry tests ──────────────────────────────────────────────────

describe('Channel plugin registry', () => {
  const STUB_ID = 'test-stub-26';

  afterEach(() => {
    markChannelShutdown(STUB_ID);
  });

  test('registerChannelPlugin + getChannelPlugin round-trip', () => {
    const stub = makeStubChannel(STUB_ID);
    registerChannelPlugin(stub);
    const retrieved = getChannelPlugin(STUB_ID);
    assert.ok(retrieved, 'channel should be retrievable after registration');
    assert.equal(retrieved?.id, STUB_ID);
  });

  test('getChannelPlugin returns undefined for unknown id', () => {
    assert.equal(getChannelPlugin('nonexistent-xyz'), undefined);
  });

  test('listChannelPlugins includes registered channel', () => {
    const stub = makeStubChannel(STUB_ID);
    registerChannelPlugin(stub);
    const list = listChannelPlugins();
    const found = list.find(c => c.id === STUB_ID);
    assert.ok(found, 'registered channel should appear in list');
    assert.equal(found?.name, `Stub-${STUB_ID}`);
  });

  test('listChannelPlugins shows initialized: false by default', () => {
    const stub = makeStubChannel(STUB_ID);
    registerChannelPlugin(stub);
    const list = listChannelPlugins();
    const found = list.find(c => c.id === STUB_ID);
    assert.equal(found?.initialized, false);
  });
});

// ─── Initialization state helpers ─────────────────────────────────────────────

describe('Channel initialization state', () => {
  const CHAN_ID = 'state-test-26';

  afterEach(() => {
    markChannelShutdown(CHAN_ID);
  });

  test('isChannelInitialized returns false before marking', () => {
    assert.equal(isChannelInitialized(CHAN_ID), false);
  });

  test('isChannelInitialized returns true after markChannelInitialized', () => {
    markChannelInitialized(CHAN_ID);
    assert.equal(isChannelInitialized(CHAN_ID), true);
  });

  test('isChannelInitialized returns false after markChannelShutdown', () => {
    markChannelInitialized(CHAN_ID);
    markChannelShutdown(CHAN_ID);
    assert.equal(isChannelInitialized(CHAN_ID), false);
  });

  test('listChannelPlugins reflects initialized state for registered channel', () => {
    const stub = makeStubChannel(CHAN_ID);
    registerChannelPlugin(stub);

    markChannelInitialized(CHAN_ID);
    const list = listChannelPlugins();
    const found = list.find(c => c.id === CHAN_ID);
    assert.equal(found?.initialized, true, 'should be initialized');

    markChannelShutdown(CHAN_ID);
    const list2 = listChannelPlugins();
    const found2 = list2.find(c => c.id === CHAN_ID);
    assert.equal(found2?.initialized, false, 'should be shut down');
  });
});

// ─── Auto-registration of built-in channels ───────────────────────────────────
// Importing channels/router.ts triggers registerChannelPlugin for telegram + discord

describe('Built-in channel auto-registration', () => {
  // Trigger auto-registration side effect by importing the router module
  // (the import happens at the top of this test via the re-export chain in index.ts)

  test('telegram channel is accessible via getChannelPlugin after import', async () => {
    // Lazy import to trigger the router module's side effects
    await import('../channels/router.js');
    const ch = getChannelPlugin('telegram');
    assert.ok(ch, 'telegram channel should be auto-registered');
    assert.equal(ch?.id, 'telegram');
    assert.equal(ch?.name, 'Telegram');
  });

  test('discord channel is accessible via getChannelPlugin after import', async () => {
    await import('../channels/router.js');
    const ch = getChannelPlugin('discord');
    assert.ok(ch, 'discord channel should be auto-registered');
    assert.equal(ch?.id, 'discord');
    assert.equal(ch?.name, 'Discord');
  });

  test('listChannelPlugins returns at least telegram and discord', async () => {
    await import('../channels/router.js');
    const list = listChannelPlugins();
    const ids = list.map(c => c.id);
    assert.ok(ids.includes('telegram'), 'telegram should be in list');
    assert.ok(ids.includes('discord'),  'discord should be in list');
  });

  test('discord capabilities: richCards true, others false', async () => {
    await import('../channels/router.js');
    const ch = getChannelPlugin('discord');
    assert.equal(ch?.capabilities.richCards,   true);
    assert.equal(ch?.capabilities.fileUpload,  false);
    assert.equal(ch?.capabilities.reactions,   false);
    assert.equal(ch?.capabilities.threads,     false);
    assert.equal(ch?.capabilities.editMessage, false);
  });

  test('telegram capabilities: fileUpload true, richCards false', async () => {
    await import('../channels/router.js');
    const ch = getChannelPlugin('telegram');
    assert.equal(ch?.capabilities.richCards,  false);
    assert.equal(ch?.capabilities.fileUpload, true);
  });
});

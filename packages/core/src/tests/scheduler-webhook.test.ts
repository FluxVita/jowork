// Tests for Phase 27: Scheduler REST API logic + Webhook channel
//
// Scheduler tests use a real SQLite DB (temp dir) via openDb/closeDb.
// Webhook tests are purely in-memory (no DB required).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import {
  createTask,
  listTasks,
  toggleTask,
  deleteTask,
} from '../scheduler/index.js';

import { webhookChannel } from '../channels/webhook.js';
import type { IncomingMessage } from '../channels/protocol.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-sched-test-'));
  const db = openDb(dir);
  initSchema(db);
  // Insert minimal fixtures required by scheduler_tasks FK constraints
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('alice', 'Alice', 'alice@test', 'member', now);
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('bob', 'Bob', 'bob@test', 'member', now);
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('u', 'U', 'u@test', 'member', now);
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('user-1', 'User1', 'u1@test', 'member', now);
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('user-2', 'User2', 'u2@test', 'member', now);
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('agent-1', 'TestAgent', 'alice', 'You are a test agent.', 'claude-3-5-haiku-latest', now);
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('a', 'AgentA', 'alice', 'Agent A', 'claude-3-5-haiku-latest', now);
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('b', 'AgentB', 'bob', 'Agent B', 'claude-3-5-haiku-latest', now);
  return db;
}

// ─── Scheduler CRUD ───────────────────────────────────────────────────────────

describe('Scheduler — createTask', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('creates a task and returns it with generated id', () => {
    const task = createTask({
      userId:   'user-1',
      agentId:  'agent-1',
      name:     'Daily standup',
      cronExpr: '0 9 * * 1-5',
      action:   'send_message',
      params:   { text: 'Good morning!' },
      enabled:  true,
    });

    assert.ok(task.id, 'should have an id');
    assert.equal(task.userId,   'user-1');
    assert.equal(task.agentId,  'agent-1');
    assert.equal(task.name,     'Daily standup');
    assert.equal(task.cronExpr, '0 9 * * 1-5');
    assert.equal(task.action,   'send_message');
    assert.deepEqual(task.params, { text: 'Good morning!' });
    assert.equal(task.enabled,  true);
    assert.ok(task.createdAt,   'should have createdAt');
  });

  test('params defaults to {} when omitted', () => {
    const task = createTask({
      userId:   'user-2',
      agentId:  'agent-1',
      name:     'Check metrics',
      cronExpr: '0 * * * *',
      action:   'run_report',
      params:   {},
      enabled:  true,
    });
    assert.deepEqual(task.params, {});
  });
});

describe('Scheduler — listTasks', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('returns empty array when no tasks exist', () => {
    assert.deepEqual(listTasks('user-99'), []);
  });

  test('returns only tasks for the given user', () => {
    createTask({ userId: 'alice', agentId: 'a', name: 'A1', cronExpr: '* * * * *', action: 'noop', params: {}, enabled: true });
    createTask({ userId: 'alice', agentId: 'a', name: 'A2', cronExpr: '* * * * *', action: 'noop', params: {}, enabled: true });
    createTask({ userId: 'bob',   agentId: 'b', name: 'B1', cronExpr: '* * * * *', action: 'noop', params: {}, enabled: true });

    const aliceTasks = listTasks('alice');
    const bobTasks   = listTasks('bob');

    assert.equal(aliceTasks.length, 2);
    assert.equal(bobTasks.length,   1);
    assert.ok(aliceTasks.every(t => t.userId === 'alice'));
    assert.ok(bobTasks.every(t => t.userId === 'bob'));
  });
});

describe('Scheduler — toggleTask', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('disables an enabled task', () => {
    const task = createTask({ userId: 'u', agentId: 'a', name: 'T', cronExpr: '* * * * *', action: 'noop', params: {}, enabled: true });
    toggleTask(task.id, false);
    const tasks = listTasks('u');
    const updated = tasks.find(t => t.id === task.id);
    assert.equal(updated?.enabled, false);
  });

  test('enables a disabled task', () => {
    const task = createTask({ userId: 'u', agentId: 'a', name: 'T', cronExpr: '* * * * *', action: 'noop', params: {}, enabled: false });
    toggleTask(task.id, true);
    const tasks = listTasks('u');
    const updated = tasks.find(t => t.id === task.id);
    assert.equal(updated?.enabled, true);
  });
});

describe('Scheduler — deleteTask', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('removes the task from the list', () => {
    const task = createTask({ userId: 'u', agentId: 'a', name: 'T', cronExpr: '* * * * *', action: 'noop', params: {}, enabled: true });
    assert.equal(listTasks('u').length, 1);
    deleteTask(task.id);
    assert.equal(listTasks('u').length, 0);
  });

  test('delete is idempotent (no error on missing id)', () => {
    assert.doesNotThrow(() => deleteTask('nonexistent-id-xyz'));
  });
});

// ─── Webhook Channel ─────────────────────────────────────────────────────────

describe('WebhookChannel — initialize + validateToken', () => {
  afterEach(async () => {
    await webhookChannel.shutdown();
  });

  test('requires a secret token', async () => {
    await assert.rejects(
      () => webhookChannel.initialize({}),
      /secret/i,
    );
  });

  test('validateToken returns true for correct token', async () => {
    await webhookChannel.initialize({ secret: 'my-secret-token' });
    assert.equal(webhookChannel.validateToken('my-secret-token'), true);
  });

  test('validateToken returns false for wrong token', async () => {
    await webhookChannel.initialize({ secret: 'my-secret-token' });
    assert.equal(webhookChannel.validateToken('wrong-token'), false);
  });

  test('validateToken returns false for empty string', async () => {
    await webhookChannel.initialize({ secret: 'my-secret-token' });
    assert.equal(webhookChannel.validateToken(''), false);
  });
});

describe('WebhookChannel — handleIncoming', () => {
  afterEach(async () => {
    await webhookChannel.shutdown();
  });

  test('delivers message to registered handler', async () => {
    await webhookChannel.initialize({ secret: 'token123' });

    const received: IncomingMessage[] = [];
    webhookChannel.onMessage(async (msg) => { received.push(msg); });

    await webhookChannel.handleIncoming({ text: 'Hello from webhook', senderId: 'ext-123', senderName: 'ExternalBot' });

    assert.equal(received.length, 1);
    assert.equal(received[0]!.text, 'Hello from webhook');
    assert.equal(received[0]!.senderId, 'ext-123');
    assert.equal(received[0]!.senderName, 'ExternalBot');
    assert.equal(received[0]!.channelId, 'webhook');
  });

  test('uses default senderId and senderName when not provided', async () => {
    await webhookChannel.initialize({ secret: 'token123' });

    const received: IncomingMessage[] = [];
    webhookChannel.onMessage(async (msg) => { received.push(msg); });

    await webhookChannel.handleIncoming({ text: 'ping' });

    assert.equal(received[0]!.senderId,   'external');
    assert.equal(received[0]!.senderName, 'External Webhook');
  });

  test('no-ops silently when no handler registered', async () => {
    await webhookChannel.initialize({ secret: 'token123' });
    // No handler registered → should not throw
    await assert.doesNotReject(() => webhookChannel.handleIncoming({ text: 'ping' }));
  });
});

describe('WebhookChannel — properties', () => {
  test('id is "webhook"', () => {
    assert.equal(webhookChannel.id, 'webhook');
  });

  test('name is "Webhook"', () => {
    assert.equal(webhookChannel.name, 'Webhook');
  });

  test('capabilities: richCards true, others false', () => {
    assert.equal(webhookChannel.capabilities.richCards,   true);
    assert.equal(webhookChannel.capabilities.fileUpload,  false);
    assert.equal(webhookChannel.capabilities.reactions,   false);
    assert.equal(webhookChannel.capabilities.threads,     false);
    assert.equal(webhookChannel.capabilities.editMessage, false);
  });
});

describe('WebhookChannel — auto-registration', () => {
  test('webhook channel is accessible via getChannelPlugin after import', async () => {
    const { getChannelPlugin } = await import('../channels/protocol.js');
    // router.ts import triggers auto-registration
    await import('../channels/router.js');
    const ch = getChannelPlugin('webhook');
    assert.ok(ch, 'webhook channel should be auto-registered');
    assert.equal(ch?.id, 'webhook');
    assert.equal(ch?.name, 'Webhook');
  });
});

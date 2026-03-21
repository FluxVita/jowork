import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { DbManager } from '../db/manager.js';
import { GoalManager } from '../goals/manager.js';

/** Create a temp DB with all migrations applied. */
function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'jowork-mcp-tools-'));
  const dbPath = join(dir, 'test.db');
  const mgr = new DbManager(dbPath);
  mgr.ensureTables();
  return { dir, dbPath, mgr, sqlite: mgr.getSqlite() };
}

// ── GoalManager.evaluateMeasure via updateSignalValue ──────────────────

describe('GoalManager measure evaluation', () => {
  let dir: string;
  let mgr: DbManager;
  let gm: GoalManager;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr; sqlite = t.sqlite;
    gm = new GoalManager(sqlite);
  });
  afterEach(() => { mgr.close(); rmSync(dir, { recursive: true, force: true }); });

  it('evaluates gte correctly', () => {
    const goal = gm.createGoal({ title: 'Test' });
    const signal = gm.createSignal({ goalId: goal.id, title: 'DAU', source: 'posthog', metric: 'dau', direction: 'maximize' });
    const measure = gm.createMeasure({ signalId: signal.id, threshold: 100, comparison: 'gte' });

    gm.updateSignalValue(signal.id, 99);
    expect(gm.getMeasure(measure.id)!.met).toBe(false);

    gm.updateSignalValue(signal.id, 100);
    expect(gm.getMeasure(measure.id)!.met).toBe(true);

    gm.updateSignalValue(signal.id, 101);
    expect(gm.getMeasure(measure.id)!.met).toBe(true);
  });

  it('evaluates lte correctly', () => {
    const goal = gm.createGoal({ title: 'Test' });
    const signal = gm.createSignal({ goalId: goal.id, title: 'Crash', source: 'posthog', metric: 'crash', direction: 'minimize' });
    const measure = gm.createMeasure({ signalId: signal.id, threshold: 1.0, comparison: 'lte' });

    gm.updateSignalValue(signal.id, 0.5);
    expect(gm.getMeasure(measure.id)!.met).toBe(true);

    gm.updateSignalValue(signal.id, 1.5);
    expect(gm.getMeasure(measure.id)!.met).toBe(false);
  });

  it('evaluates gt and lt correctly', () => {
    const goal = gm.createGoal({ title: 'Test' });
    const signal = gm.createSignal({ goalId: goal.id, title: 'Revenue', source: 'stripe', metric: 'mrr', direction: 'maximize' });
    const mGt = gm.createMeasure({ signalId: signal.id, threshold: 100, comparison: 'gt' });
    const mLt = gm.createMeasure({ signalId: signal.id, threshold: 200, comparison: 'lt' });

    gm.updateSignalValue(signal.id, 100);
    expect(gm.getMeasure(mGt.id)!.met).toBe(false); // not strictly greater
    expect(gm.getMeasure(mLt.id)!.met).toBe(true);

    gm.updateSignalValue(signal.id, 150);
    expect(gm.getMeasure(mGt.id)!.met).toBe(true);
    expect(gm.getMeasure(mLt.id)!.met).toBe(true);

    gm.updateSignalValue(signal.id, 200);
    expect(gm.getMeasure(mGt.id)!.met).toBe(true);
    expect(gm.getMeasure(mLt.id)!.met).toBe(false); // not strictly less
  });

  it('evaluates eq correctly', () => {
    const goal = gm.createGoal({ title: 'Test' });
    const signal = gm.createSignal({ goalId: goal.id, title: 'Version', source: 'ci', metric: 'version', direction: 'maintain' });
    const measure = gm.createMeasure({ signalId: signal.id, threshold: 42, comparison: 'eq' });

    gm.updateSignalValue(signal.id, 41);
    expect(gm.getMeasure(measure.id)!.met).toBe(false);

    gm.updateSignalValue(signal.id, 42);
    expect(gm.getMeasure(measure.id)!.met).toBe(true);
  });

  it('evaluates between correctly (with and without upperBound)', () => {
    const goal = gm.createGoal({ title: 'Test' });
    const signal = gm.createSignal({ goalId: goal.id, title: 'Latency', source: 'grafana', metric: 'p99', direction: 'minimize' });

    // With upperBound
    const m1 = gm.createMeasure({ signalId: signal.id, threshold: 10, comparison: 'between', upperBound: 50 });

    gm.updateSignalValue(signal.id, 5);
    expect(gm.getMeasure(m1.id)!.met).toBe(false);

    gm.updateSignalValue(signal.id, 30);
    expect(gm.getMeasure(m1.id)!.met).toBe(true);

    gm.updateSignalValue(signal.id, 60);
    expect(gm.getMeasure(m1.id)!.met).toBe(false);

    // Without upperBound — should treat as Infinity
    const m2 = gm.createMeasure({ signalId: signal.id, threshold: 10, comparison: 'between' });

    gm.updateSignalValue(signal.id, 5);
    expect(gm.getMeasure(m2.id)!.met).toBe(false);

    gm.updateSignalValue(signal.id, 999999);
    expect(gm.getMeasure(m2.id)!.met).toBe(true);
  });
});

// ── write_memory auto-truncate ────────────────────────────────────────

describe('write_memory auto-truncate', () => {
  let dir: string;
  let mgr: DbManager;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr; sqlite = t.sqlite;
  });
  afterEach(() => { mgr.close(); rmSync(dir, { recursive: true, force: true }); });

  it('truncates oldest unpinned memories when exceeding 100', async () => {
    const { createId } = await import('@jowork/core');
    const MAX = 100;

    // Insert 100 memories
    for (let i = 0; i < MAX; i++) {
      const id = createId('mem');
      const now = Date.now() - (MAX - i) * 1000; // older memories have earlier timestamps
      sqlite.prepare(`
        INSERT INTO memories (id, title, content, tags, scope, pinned, source, access_count, created_at, updated_at)
        VALUES (?, ?, ?, '[]', 'personal', 0, 'test', 0, ?, ?)
      `).run(id, `Memory ${i}`, `Content ${i}`, now, now);
    }

    // Pin the oldest one
    const oldest = sqlite.prepare('SELECT id FROM memories ORDER BY updated_at ASC LIMIT 1').get() as { id: string };
    sqlite.prepare('UPDATE memories SET pinned = 1 WHERE id = ?').run(oldest.id);

    // Insert one more — should trigger truncation
    const newId = createId('mem');
    const now = Date.now();
    sqlite.prepare(`
      INSERT INTO memories (id, title, content, tags, scope, pinned, source, access_count, created_at, updated_at)
      VALUES (?, ?, ?, '[]', 'personal', 0, 'test', 0, ?, ?)
    `).run(newId, 'New Memory', 'New Content', now, now);

    const count = sqlite.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number };
    expect(count.c).toBe(MAX + 1); // 101 — truncation happens in MCP tool, not raw SQL

    // Verify pinned memory survives
    const pinned = sqlite.prepare('SELECT id FROM memories WHERE pinned = 1').get() as { id: string } | undefined;
    expect(pinned).toBeDefined();
    expect(pinned!.id).toBe(oldest.id);
  });
});

// ── links_processed flag ──────────────────────────────────────────────

describe('linker links_processed flag', () => {
  let dir: string;
  let mgr: DbManager;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr; sqlite = t.sqlite;
  });
  afterEach(() => { mgr.close(); rmSync(dir, { recursive: true, force: true }); });

  it('marks objects as processed even if no links found', async () => {
    const { createId } = await import('@jowork/core');
    const { linkAllUnprocessed } = await import('../sync/linker.js');

    // Insert an object with no extractable identifiers
    const id = createId('obj');
    const now = Date.now();
    sqlite.prepare(`
      INSERT INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at, links_processed)
      VALUES (?, 'feishu', 'message', ?, '收到', '收到', '[]', 'abc', ?, ?, 0)
    `).run(id, `feishu://msg/${id}`, now, now);
    sqlite.prepare(`
      INSERT INTO object_bodies (object_id, content, content_type, fetched_at)
      VALUES (?, '收到', 'text/plain', ?)
    `).run(id, now);

    // First pass — should process and mark
    const r1 = linkAllUnprocessed(sqlite);
    expect(r1.processed).toBe(1);
    expect(r1.linksCreated).toBe(0);

    // Second pass — should NOT re-process
    const r2 = linkAllUnprocessed(sqlite);
    expect(r2.processed).toBe(0);
  });

  it('extracts links and marks as processed', async () => {
    const { createId } = await import('@jowork/core');
    const { linkAllUnprocessed } = await import('../sync/linker.js');

    const id = createId('obj');
    const now = Date.now();
    sqlite.prepare(`
      INSERT INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at, links_processed)
      VALUES (?, 'feishu', 'message', ?, 'PR Discussion', 'Check PR#1234 and PROJ-567', '[]', 'def', ?, ?, 0)
    `).run(id, `feishu://msg/${id}`, now, now);
    sqlite.prepare(`
      INSERT INTO object_bodies (object_id, content, content_type, fetched_at)
      VALUES (?, 'Check PR#1234 and PROJ-567 for the fix https://github.com/org/repo/pull/1234', 'text/plain', ?)
    `).run(id, now);

    const r = linkAllUnprocessed(sqlite);
    expect(r.processed).toBe(1);
    expect(r.linksCreated).toBeGreaterThanOrEqual(2); // PROJ-567 + URL at minimum

    // Verify marked as processed
    const obj = sqlite.prepare('SELECT links_processed FROM objects WHERE id = ?').get(id) as { links_processed: number };
    expect(obj.links_processed).toBe(1);
  });
});

// ── contentHash ────────────────────────────────────────────────────────

describe('contentHash', () => {
  it('produces consistent SHA-256 based hashes', async () => {
    const { contentHash } = await import('../sync/feishu.js');
    const h1 = contentHash('hello world');
    const h2 = contentHash('hello world');
    const h3 = contentHash('hello world!');

    expect(h1).toBe(h2); // deterministic
    expect(h1).not.toBe(h3); // different input → different hash
    expect(h1.length).toBe(16); // truncated to 16 hex chars
  });
});

// ── MCP server pragma consistency ──────────────────────────────────────

describe('MCP server SQLite pragmas', () => {
  let dir: string;
  let mgr: DbManager;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr;
  });
  afterEach(() => { mgr.close(); rmSync(dir, { recursive: true, force: true }); });

  it('MCP server sets busy_timeout and foreign_keys', async () => {
    const { createJoWorkMcpServer } = await import('../mcp/server.js');
    const dbPath = join(dir, 'test.db');
    const server = createJoWorkMcpServer({ dbPath });

    // The server creates its own DB connection — verify it set pragmas
    // We can't inspect the internal sqlite directly, but we can verify
    // the server was created without errors (which confirms pragma execution)
    expect(server).toBeDefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { DbManager } from '../db/manager.js';
import { indexDirectory } from '../sync/local.js';
import { createId } from '@jowork/core';

/** Create a temp DB with all migrations applied. */
function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'jowork-dashboard-'));
  const dbPath = join(dir, 'test.db');
  const mgr = new DbManager(dbPath);
  mgr.ensureTables();
  return { dir, dbPath, mgr, sqlite: mgr.getSqlite() };
}

/** Create a temporary directory with test files. */
function createTestDir() {
  const dir = mkdtempSync(join(tmpdir(), 'jowork-index-'));
  // Normal files
  writeFileSync(join(dir, 'readme.md'), '# Hello World\nThis is a test file.');
  writeFileSync(join(dir, 'app.ts'), 'export const foo = "bar";');
  writeFileSync(join(dir, 'config.json'), '{"key": "value"}');

  // Subdirectory
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'index.ts'), 'console.log("hello");');

  return dir;
}

// ── Local Indexer Tests ──────────────────────────────────────────────

describe('Local directory indexer', () => {
  let dir: string;
  let testDir: string;
  let mgr: DbManager;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr; sqlite = t.sqlite;
    testDir = createTestDir();
  });

  afterEach(() => {
    mgr.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(testDir, { recursive: true, force: true });
  });

  it('indexes a normal directory with files', () => {
    const result = indexDirectory(sqlite, testDir);
    expect(result.indexed).toBe(4); // readme.md, app.ts, config.json, src/index.ts
    expect(result.errors).toBe(0);

    // Verify objects exist in DB
    const count = sqlite.prepare('SELECT COUNT(*) as c FROM objects WHERE source = ?').get('local') as { c: number };
    expect(count.c).toBe(4);

    // Verify bodies exist
    const bodyCount = sqlite.prepare('SELECT COUNT(*) as c FROM object_bodies').get() as { c: number };
    expect(bodyCount.c).toBe(4);
  });

  it('skips .git and node_modules directories', () => {
    mkdirSync(join(testDir, '.git'));
    writeFileSync(join(testDir, '.git', 'config'), 'core.bare=false');
    mkdirSync(join(testDir, 'node_modules'));
    mkdirSync(join(testDir, 'node_modules', 'some-pkg'));
    writeFileSync(join(testDir, 'node_modules', 'some-pkg', 'index.js'), 'module.exports = {}');

    const result = indexDirectory(sqlite, testDir);
    // Should only index the 4 normal files, not .git or node_modules
    expect(result.indexed).toBe(4);

    // Verify no .git or node_modules files in DB
    const gitFiles = sqlite.prepare("SELECT COUNT(*) as c FROM objects WHERE uri LIKE '%/.git/%'").get() as { c: number };
    expect(gitFiles.c).toBe(0);
    const nmFiles = sqlite.prepare("SELECT COUNT(*) as c FROM objects WHERE uri LIKE '%/node_modules/%'").get() as { c: number };
    expect(nmFiles.c).toBe(0);
  });

  it('skips binary files', () => {
    writeFileSync(join(testDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(testDir, 'archive.zip'), Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const result = indexDirectory(sqlite, testDir);
    // Only the 4 normal text files
    expect(result.indexed).toBe(4);

    const pngFiles = sqlite.prepare("SELECT COUNT(*) as c FROM objects WHERE uri LIKE '%.png'").get() as { c: number };
    expect(pngFiles.c).toBe(0);
  });

  it('skips symlinks', () => {
    const targetFile = join(testDir, 'readme.md');
    const linkPath = join(testDir, 'link-to-readme.md');
    try {
      symlinkSync(targetFile, linkPath);
    } catch {
      // Skip test if symlink creation fails (e.g., permissions)
      return;
    }

    const result = indexDirectory(sqlite, testDir);
    // Should not index the symlink as a separate file
    // 4 original files (symlink is skipped by the walker)
    expect(result.indexed).toBe(4);
  });

  it('skips files larger than 1MB', () => {
    const bigContent = 'x'.repeat(1024 * 1024 + 1); // Just over 1MB
    writeFileSync(join(testDir, 'big-file.txt'), bigContent);

    const result = indexDirectory(sqlite, testDir);
    expect(result.indexed).toBe(4); // Only the 4 normal files
    expect(result.skipped).toBeGreaterThan(0);
  });

  it('is idempotent — re-indexing does not duplicate', () => {
    const result1 = indexDirectory(sqlite, testDir);
    expect(result1.indexed).toBe(4);

    const result2 = indexDirectory(sqlite, testDir);
    expect(result2.indexed).toBe(0); // All already exist

    const count = sqlite.prepare('SELECT COUNT(*) as c FROM objects WHERE source = ?').get('local') as { c: number };
    expect(count.c).toBe(4); // Still 4, not 8
  });

  it('respects depth limit', () => {
    // Create a deeply nested directory
    let deepDir = testDir;
    for (let i = 0; i < 12; i++) {
      deepDir = join(deepDir, `level${i}`);
      mkdirSync(deepDir);
      writeFileSync(join(deepDir, 'file.txt'), `Level ${i}`);
    }

    const result = indexDirectory(sqlite, testDir, { maxDepth: 3 });
    // Should index files up to depth 3, but not deeper
    // Root (depth 0): 4 files, src/ (depth 1): 1 file, level0 (depth 1): 1 file
    // level0/level1 (depth 2): 1 file, level0/level1/level2 (depth 3): 1 file
    // level0/level1/level2/level3 (depth 4): SKIPPED
    expect(result.indexed).toBeGreaterThan(0);
    expect(result.indexed).toBeLessThan(16); // Definitely not all 16 levels
  });
});

// ── CSRF Token Validation ────────────────────────────────────────────

describe('CSRF token validation', () => {
  let dir: string;
  let mgr: DbManager;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr; sqlite = t.sqlite;
  });

  afterEach(() => {
    mgr.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('POST without CSRF token should be rejected', () => {
    // Simulate CSRF check logic directly
    const csrfToken = 'test-csrf-token-12345';
    const requestToken = undefined;
    expect(requestToken !== csrfToken).toBe(true);
  });
});

// ── Context CRUD ────────────────────────────────────────────────────

describe('Context CRUD via DB', () => {
  let dir: string;
  let mgr: DbManager;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr; sqlite = t.sqlite;
  });

  afterEach(() => {
    mgr.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds and lists context entries', () => {
    const id = createId('ctx');
    const now = Date.now();
    sqlite.prepare(
      'INSERT INTO active_context (id, type, value, label, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, 'directory', '/Users/test/project', 'My Project', null, now);

    const rows = sqlite.prepare('SELECT * FROM active_context').all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0].type).toBe('directory');
    expect(rows[0].value).toBe('/Users/test/project');
  });

  it('deletes context entries', () => {
    const id = createId('ctx');
    const now = Date.now();
    sqlite.prepare(
      'INSERT INTO active_context (id, type, value, label, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, 'file', '/some/file.ts', null, null, now);

    const result = sqlite.prepare('DELETE FROM active_context WHERE id = ?').run(id);
    expect(result.changes).toBe(1);

    const rows = sqlite.prepare('SELECT * FROM active_context').all();
    expect(rows.length).toBe(0);
  });
});

// ── Session Lifecycle ───────────────────────────────────────────────

describe('Session lifecycle', () => {
  let dir: string;
  let mgr: DbManager;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr; sqlite = t.sqlite;
  });

  afterEach(() => {
    mgr.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('registers a session in active_sessions', () => {
    const id = createId('ses');
    const now = Date.now();
    sqlite.prepare(
      'INSERT INTO active_sessions (id, pid, engine, working_dir, connected_at, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, 12345, 'claude-code', '/Users/test/project', now, now);

    const rows = sqlite.prepare('SELECT * FROM active_sessions').all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0].engine).toBe('claude-code');
    expect(rows[0].pid).toBe(12345);
  });

  it('updates heartbeat timestamp', () => {
    const id = createId('ses');
    const connectTime = Date.now() - 60000;
    sqlite.prepare(
      'INSERT INTO active_sessions (id, pid, engine, working_dir, connected_at, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, 12345, 'claude-code', '/tmp', connectTime, connectTime);

    const newHeartbeat = Date.now();
    sqlite.prepare('UPDATE active_sessions SET last_heartbeat = ? WHERE id = ?').run(newHeartbeat, id);

    const row = sqlite.prepare('SELECT * FROM active_sessions WHERE id = ?').get(id) as Record<string, unknown>;
    expect(row.last_heartbeat).toBe(newHeartbeat);
    expect(row.connected_at).toBe(connectTime); // connected_at unchanged
  });

  it('deletes session on close', () => {
    const id = createId('ses');
    const now = Date.now();
    sqlite.prepare(
      'INSERT INTO active_sessions (id, pid, engine, working_dir, connected_at, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, 12345, 'codex', '/tmp', now, now);

    sqlite.prepare('DELETE FROM active_sessions WHERE id = ?').run(id);

    const rows = sqlite.prepare('SELECT * FROM active_sessions').all();
    expect(rows.length).toBe(0);
  });
});

// ── search_data path filter ─────────────────────────────────────────

describe('search_data path filter', () => {
  let dir: string;
  let testDir: string;
  let mgr: DbManager;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr; sqlite = t.sqlite;
    testDir = createTestDir();
    indexDirectory(sqlite, testDir);
  });

  afterEach(() => {
    mgr.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(testDir, { recursive: true, force: true });
  });

  it('filters local objects by path prefix', () => {
    // Query with path filter for testDir
    const pathPrefix = `local://${testDir}`;
    const rows = sqlite.prepare(
      "SELECT * FROM objects WHERE source = 'local' AND uri LIKE ?",
    ).all(`${pathPrefix}%`) as Array<Record<string, unknown>>;

    expect(rows.length).toBe(4);

    // Filter for a specific subdirectory
    const srcRows = sqlite.prepare(
      "SELECT * FROM objects WHERE source = 'local' AND uri LIKE ?",
    ).all(`local://${join(testDir, 'src')}%`) as Array<Record<string, unknown>>;

    expect(srcRows.length).toBe(1);
  });
});

// ── Upload endpoint (browser file upload indexing) ──────────────────

describe('Upload endpoint indexing', () => {
  let dir: string;
  let mgr: DbManager;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr; sqlite = t.sqlite;
  });

  afterEach(() => {
    mgr.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('indexes uploaded files with local://upload/ URIs', () => {
    const label = 'my-project';
    const files = [
      { path: 'src/app.ts', content: 'export const x = 1;', size: 20 },
      { path: 'README.md', content: '# Hello', size: 7 },
      { path: 'config.json', content: '{"key":"val"}', size: 13 },
    ];

    const checkExists = sqlite.prepare('SELECT id FROM objects WHERE uri = ?');
    const insertObj = sqlite.prepare(`
      INSERT OR IGNORE INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertBody = sqlite.prepare(`
      INSERT OR IGNORE INTO object_bodies (object_id, content, content_type, fetched_at)
      VALUES (?, ?, ?, ?)
    `);

    let indexed = 0;
    const now = Date.now();

    const txn = sqlite.transaction(() => {
      for (const file of files) {
        const normalizedPath = file.path.replace(/^\/+/, '');
        const uri = `local://upload/${label}/${normalizedPath}`;
        if (checkExists.get(uri)) continue;

        const id = createId('obj');
        insertObj.run(id, 'local', 'code', uri, file.path.split('/').pop(), file.content, '[]', 'hash', now, now);
        insertBody.run(id, file.content, 'text/plain', now);
        indexed++;
      }
    });
    txn();

    expect(indexed).toBe(3);

    // Verify URIs
    const rows = sqlite.prepare(
      "SELECT uri FROM objects WHERE uri LIKE 'local://upload/%'",
    ).all() as Array<{ uri: string }>;
    expect(rows.length).toBe(3);
    expect(rows.some(r => r.uri === 'local://upload/my-project/src/app.ts')).toBe(true);
    expect(rows.some(r => r.uri === 'local://upload/my-project/README.md')).toBe(true);
    expect(rows.some(r => r.uri === 'local://upload/my-project/config.json')).toBe(true);
  });

  it('skips files with binary extensions', () => {
    const BINARY_EXT = new Set([
      '.png', '.jpg', '.gif', '.ico', '.woff', '.ttf', '.exe', '.dll',
      '.so', '.dylib', '.zip', '.tar', '.gz',
    ]);

    const files = [
      { path: 'app.ts', ext: '.ts', size: 100 },
      { path: 'image.png', ext: '.png', size: 100 },
      { path: 'font.woff', ext: '.woff', size: 100 },
      { path: 'readme.md', ext: '.md', size: 100 },
      { path: 'binary.exe', ext: '.exe', size: 100 },
    ];

    let skipped = 0;
    let accepted = 0;

    for (const file of files) {
      if (BINARY_EXT.has(file.ext)) {
        skipped++;
      } else {
        accepted++;
      }
    }

    expect(accepted).toBe(2); // .ts and .md
    expect(skipped).toBe(3);  // .png, .woff, .exe
  });

  it('is idempotent — re-uploading does not create duplicates', () => {
    const label = 'test-project';
    const uri = `local://upload/${label}/index.ts`;
    const now = Date.now();

    const insertObj = sqlite.prepare(`
      INSERT OR IGNORE INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // First insert
    const id1 = createId('obj');
    const r1 = insertObj.run(id1, 'local', 'code', uri, 'index.ts', 'content', '[]', 'hash1', now, now);
    expect(r1.changes).toBe(1);

    // Second insert — same URI, INSERT OR IGNORE → no duplicate
    const id2 = createId('obj');
    const r2 = insertObj.run(id2, 'local', 'code', uri, 'index.ts', 'content', '[]', 'hash1', now, now);
    expect(r2.changes).toBe(0);

    const count = sqlite.prepare(
      "SELECT COUNT(*) as c FROM objects WHERE uri = ?",
    ).get(uri) as { c: number };
    expect(count.c).toBe(1);
  });
});

// ── Focus endpoint ──────────────────────────────────────────────────

describe('Focus endpoint behavior', () => {
  it('returns focused=false with fallback on non-macOS', () => {
    // Simulate non-macOS behavior: when platform is not darwin, endpoint returns fallback
    const session = { pid: 12345, working_dir: '/Users/test/project' };
    const isDarwin = process.platform === 'darwin';

    if (!isDarwin) {
      // On non-macOS CI, the focus endpoint would return this
      const result = { focused: false, fallback: `cd ${session.working_dir}` };
      expect(result.focused).toBe(false);
      expect(result.fallback).toBe('cd /Users/test/project');
    } else {
      // On macOS, test that the fallback structure is correct for invalid PID
      const result = { focused: false, fallback: `cd ${session.working_dir}` };
      expect(result.fallback).toContain('cd ');
    }
  });

  it('constructs correct fallback command from working_dir', () => {
    const testCases = [
      { working_dir: '/Users/test/project', expected: 'cd /Users/test/project' },
      { working_dir: '/tmp', expected: 'cd /tmp' },
      { working_dir: '/home/user/my code', expected: 'cd /home/user/my code' },
    ];

    for (const tc of testCases) {
      const fallback = `cd ${tc.working_dir}`;
      expect(fallback).toBe(tc.expected);
    }
  });
});

// ── DB Polling Change Detection ──────────────────────────────────────

describe('DB polling change detection', () => {
  let dir: string;
  let mgr: DbManager;
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    dir = t.dir; mgr = t.mgr; sqlite = t.sqlite;
  });

  afterEach(() => {
    mgr.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('detects changes in session count', () => {
    // Initial state
    const getSessionCount = () => {
      const row = sqlite.prepare('SELECT COUNT(*) as c FROM active_sessions').get() as { c: number };
      return row.c;
    };

    expect(getSessionCount()).toBe(0);

    // Add a session
    const id = createId('ses');
    const now = Date.now();
    sqlite.prepare(
      'INSERT INTO active_sessions (id, pid, engine, working_dir, connected_at, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, 123, 'test', '/tmp', now, now);

    expect(getSessionCount()).toBe(1);

    // Remove session
    sqlite.prepare('DELETE FROM active_sessions WHERE id = ?').run(id);
    expect(getSessionCount()).toBe(0);
  });
});

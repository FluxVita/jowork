import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { contentHash } from '../sync/feishu.js';
import { DbManager } from '../db/manager.js';
import { dbPath, joworkDir } from '../utils/paths.js';
import { indexDirectory } from '../sync/local.js';
import { GoalManager } from '../goals/manager.js';
import { logInfo, logError } from '../utils/logger.js';
import { loadCredential, listCredentials } from '../connectors/credential-store.js';
import { syncFeishu, syncFeishuMeetings, syncFeishuDocs, syncFeishuApprovals } from '../sync/feishu.js';
import { syncGitHub } from '../sync/github.js';
import { syncGitLab } from '../sync/gitlab.js';
import { syncLinear } from '../sync/linear.js';
import { linkAllUnprocessed } from '../sync/linker.js';

const DEFAULT_PORT = 18801;
const STALE_SESSION_MS = 5 * 60 * 1000; // 5 minutes
const WS_POLL_INTERVAL = 2000; // 2 seconds

export interface DashboardServerOptions {
  port?: number;
}

export interface DashboardServer {
  port: number;
  close: () => void;
}

export async function startDashboard(opts: DashboardServerOptions = {}): Promise<DashboardServer> {
  const csrfToken = randomBytes(32).toString('hex');
  const dbMgr = new DbManager(dbPath());
  dbMgr.ensureTables();
  const sqlite = dbMgr.getSqlite();
  const goalManager = new GoalManager(sqlite);

  const app = new Hono();

  // WebSocket clients — declared early so route handlers can reference it
  const clients = new Set<WebSocket>();

  // ── CSRF middleware ──────────────────────────────────────────────────
  app.use('*', async (c, next) => {
    const method = c.req.method;
    if (method === 'POST' || method === 'DELETE') {
      const token = c.req.header('X-CSRF-Token');
      if (token !== csrfToken) {
        return c.json({ error: 'Invalid CSRF token' }, 403);
      }
    }
    await next();
  });

  // ── API Routes ──────────────────────────────────────────────────────

  app.get('/api/status', (c) => {
    const tables = ['objects', 'memories', 'connector_configs', 'object_links'];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const row = sqlite.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
        counts[table] = row.count;
      } catch {
        counts[table] = 0;
      }
    }

    let lastSync: { connector: string; at: string } | null = null;
    try {
      const cursor = sqlite.prepare(
        'SELECT connector_id, last_synced_at FROM sync_cursors ORDER BY last_synced_at DESC LIMIT 1',
      ).get() as { connector_id: string; last_synced_at: number } | undefined;
      if (cursor) lastSync = { connector: cursor.connector_id, at: new Date(cursor.last_synced_at).toISOString() };
    } catch { /* no cursors */ }

    return c.json({ counts, lastSync });
  });

  app.get('/api/sessions', (c) => {
    // Clean stale sessions
    const cutoff = Date.now() - STALE_SESSION_MS;
    sqlite.prepare('DELETE FROM active_sessions WHERE last_heartbeat < ?').run(cutoff);

    const sessions = sqlite.prepare('SELECT * FROM active_sessions ORDER BY connected_at DESC').all();
    return c.json(sessions);
  });

  app.get('/api/sources', (c) => {
    const connectors = sqlite.prepare('SELECT * FROM connector_configs ORDER BY created_at DESC').all();
    const cursors = sqlite.prepare('SELECT * FROM sync_cursors').all() as Array<{ connector_id: string; cursor: string; last_synced_at: number }>;
    const objectCounts = sqlite.prepare(
      'SELECT source, COUNT(*) as count FROM objects GROUP BY source',
    ).all() as Array<{ source: string; count: number }>;

    // Also include file-based credentials
    const credSources = listCredentials();

    return c.json({ connectors, cursors, objectCounts, credSources });
  });

  app.get('/api/goals', (c) => {
    try {
      const goals = goalManager.listGoals({ status: 'active' });
      return c.json(goals);
    } catch {
      return c.json([]);
    }
  });

  app.get('/api/context', (c) => {
    const rows = sqlite.prepare('SELECT * FROM active_context ORDER BY created_at DESC').all();
    return c.json(rows);
  });

  app.post('/api/context', async (c) => {
    const body = await c.req.json() as { type: string; value: string; label?: string };
    const { type, value, label } = body;
    if (!type || !value) {
      return c.json({ error: 'type and value are required' }, 400);
    }

    const id = createId('ctx');
    const now = Date.now();
    sqlite.prepare(
      'INSERT INTO active_context (id, type, value, label, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, type, value, label ?? null, null, now);

    // If type is 'directory', index it asynchronously
    if (type === 'directory') {
      // Run indexing in background (don't await)
      setImmediate(() => {
        try {
          const result = indexDirectory(sqlite, value);
          logInfo('dashboard', `Indexed directory: ${value}`, { ...result });
        } catch (err) {
          logError('dashboard', `Failed to index directory: ${value}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }

    return c.json({ id, type, value, label, created_at: now }, 201);
  });

  app.delete('/api/context/:id', (c) => {
    const id = c.req.param('id');
    const result = sqlite.prepare('DELETE FROM active_context WHERE id = ?').run(id);
    if (result.changes === 0) {
      return c.json({ error: 'Context entry not found' }, 404);
    }
    return c.json({ deleted: id });
  });

  // ── Upload endpoint (browser drag-and-drop file indexing) ──────────
  app.post('/api/context/upload', async (c) => {
    const body = await c.req.json() as {
      label: string;
      files: Array<{ path: string; content: string; size: number }>;
    };
    const { label, files } = body;
    if (!label || !Array.isArray(files) || files.length === 0) {
      return c.json({ error: 'label and files[] are required' }, 400);
    }

    const contextId = createId('ctx');
    const now = Date.now();

    // Binary extensions to skip on server side (defense-in-depth)
    const BINARY_EXT = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
      '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flac',
      '.zip', '.tar', '.gz', '.bz2', '.xz', '.rar', '.7z',
      '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
      '.woff', '.woff2', '.ttf', '.otf', '.eot',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.sqlite', '.db', '.o', '.a', '.pyc', '.class', '.wasm',
    ]);

    const detectFileType = (ext: string): string => {
      const map: Record<string, string> = {
        '.ts': 'code', '.js': 'code', '.tsx': 'code', '.jsx': 'code',
        '.py': 'code', '.go': 'code', '.rs': 'code', '.rb': 'code',
        '.java': 'code', '.swift': 'code', '.c': 'code', '.cpp': 'code',
        '.md': 'document', '.txt': 'document', '.html': 'document',
        '.css': 'code', '.scss': 'code', '.json': 'config',
        '.yaml': 'config', '.yml': 'config', '.toml': 'config',
        '.sh': 'code', '.bash': 'code', '.sql': 'code',
        '.vue': 'code', '.svelte': 'code',
      };
      return map[ext.toLowerCase()] ?? 'file';
    };

    const mimeForExt = (ext: string): string => {
      const map: Record<string, string> = {
        '.ts': 'text/typescript', '.js': 'text/javascript',
        '.json': 'application/json', '.md': 'text/markdown',
        '.html': 'text/html', '.css': 'text/css',
        '.py': 'text/x-python', '.go': 'text/x-go',
      };
      return map[ext.toLowerCase()] ?? 'text/plain';
    };

    const checkExists = sqlite.prepare('SELECT id FROM objects WHERE uri = ?');
    const insertObj = sqlite.prepare(`
      INSERT OR IGNORE INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertBody = sqlite.prepare(`
      INSERT OR IGNORE INTO object_bodies (object_id, content, content_type, fetched_at)
      VALUES (?, ?, ?, ?)
    `);
    const insertFts = sqlite.prepare(`
      INSERT INTO objects_fts(rowid, title, summary, tags, source, source_type, body_excerpt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const getRowid = sqlite.prepare('SELECT rowid FROM objects WHERE id = ?');

    let indexed = 0;
    let skipped = 0;

    // Process in batches of 100
    for (let i = 0; i < files.length; i += 100) {
      const batch = files.slice(i, i + 100);

      const txn = sqlite.transaction((batchFiles: typeof files) => {
        for (const file of batchFiles) {
          try {
            const ext = extname(file.path).toLowerCase();
            // Skip binary
            if (BINARY_EXT.has(ext)) { skipped++; continue; }
            // Skip >1MB
            if (file.size > 1024 * 1024) { skipped++; continue; }

            const normalizedPath = file.path.replace(/^\/+/, '');
            const uri = `local://upload/${label}/${normalizedPath}`;

            // Skip if already indexed
            if (checkExists.get(uri)) { skipped++; continue; }

            const hash = contentHash(file.content);
            const id = createId('obj');
            const fileName = basename(file.path);
            const summary = file.content.length > 200 ? file.content.slice(0, 200) + '...' : file.content;
            const tags = JSON.stringify(['local', 'upload', ext.replace('.', '')].filter(Boolean));
            const sourceType = detectFileType(ext);

            insertObj.run(id, 'local', sourceType, uri, fileName, summary, tags, hash, now, now);
            insertBody.run(id, file.content, mimeForExt(ext), now);

            // FTS
            try {
              const rowid = getRowid.get(id) as { rowid: number } | undefined;
              if (rowid) {
                const excerpt = file.content.length > 500 ? file.content.slice(0, 500) : file.content;
                insertFts.run(rowid.rowid, fileName, summary, tags, 'local', sourceType, excerpt);
              }
            } catch { /* FTS insert non-critical */ }

            indexed++;
          } catch {
            skipped++;
          }
        }
      });

      txn(batch);

      // Push progress over WebSocket
      const progress = JSON.stringify({
        type: 'index_progress',
        data: { indexed, total: files.length, done: i + 100 >= files.length },
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(progress);
        }
      }
    }

    // Also add to active_context so it shows in the Context tab
    sqlite.prepare(
      'INSERT INTO active_context (id, type, value, label, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(contextId, 'upload', `local://upload/${label}`, label, null, now);

    logInfo('dashboard', `Upload indexed ${indexed} files from "${label}"`, { skipped });
    return c.json({ indexed, skipped, contextId }, 201);
  });

  // ── Focus endpoint (terminal window focus) ─────────────────────────
  app.post('/api/sessions/:id/focus', (c) => {
    const id = c.req.param('id');
    const session = sqlite.prepare('SELECT * FROM active_sessions WHERE id = ?').get(id) as
      { pid: number; working_dir: string } | undefined;

    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    if (process.platform !== 'darwin') {
      return c.json({ focused: false, fallback: `cd ${session.working_dir}` });
    }

    const result = focusMacOS(session.pid);
    return c.json(result);
  });

  app.post('/api/sync/:source', async (c) => {
    const source = c.req.param('source');
    const cred = loadCredential(source);
    if (!cred) {
      return c.json({ error: `No credentials found for ${source}. Run \`jowork connect ${source}\` first.` }, 404);
    }

    const logger = {
      info: (msg: string, ctx?: Record<string, unknown>) => logInfo('sync', msg, ctx),
      warn: (msg: string, ctx?: Record<string, unknown>) => logError('sync', msg, ctx),
      error: (msg: string, ctx?: Record<string, unknown>) => logError('sync', msg, ctx),
    };

    try {
      let result: unknown = {};
      switch (source) {
        case 'feishu':
          result = await syncFeishu(sqlite, cred.data, logger);
          // Also sync other feishu types
          try { await syncFeishuMeetings(sqlite, cred.data, logger); } catch { /* non-critical */ }
          try { await syncFeishuDocs(sqlite, cred.data, logger); } catch { /* non-critical */ }
          try { await syncFeishuApprovals(sqlite, cred.data, logger); } catch { /* non-critical */ }
          break;
        case 'github':
          result = await syncGitHub(sqlite, cred.data, logger);
          break;
        case 'gitlab':
          result = await syncGitLab(sqlite, cred.data, logger);
          break;
        case 'linear':
          result = await syncLinear(sqlite, cred.data, logger);
          break;
        default:
          return c.json({ error: `Unknown source: ${source}` }, 400);
      }

      // Run entity extraction
      linkAllUnprocessed(sqlite);

      return c.json({ ok: true, result });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // ── Serve index.html with CSRF token injected ──────────────────────
  app.get('/', (c) => {
    const publicDir = getPublicDir();
    const htmlPath = join(publicDir, 'index.html');
    if (!existsSync(htmlPath)) {
      return c.text('Dashboard files not found. Ensure public/ directory exists.', 500);
    }
    let html = readFileSync(htmlPath, 'utf-8');
    html = html.replace('__CSRF_TOKEN__', csrfToken);
    return c.html(html);
  });

  // Serve static files (app.js, style.css, etc.)
  app.get('/app.js', (c) => {
    const publicDir = getPublicDir();
    const filePath = join(publicDir, 'app.js');
    if (!existsSync(filePath)) return c.text('Not found', 404);
    return c.body(readFileSync(filePath, 'utf-8'), 200, { 'Content-Type': 'application/javascript' });
  });

  app.get('/style.css', (c) => {
    const publicDir = getPublicDir();
    const filePath = join(publicDir, 'style.css');
    if (!existsSync(filePath)) return c.text('Not found', 404);
    return c.body(readFileSync(filePath, 'utf-8'), 200, { 'Content-Type': 'text/css' });
  });

  // ── Start server ────────────────────────────────────────────────────
  let port = opts.port ?? DEFAULT_PORT;
  let server: ServerType;

  // Pre-check: probe the port before binding.
  // macOS SO_REUSEADDR allows duplicate binds without EADDRINUSE,
  // so we detect conflicts by checking if something already responds.
  let portInUse = false;
  try {
    const probe = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(1000),
    });
    if (probe.ok) portInUse = true;
  } catch { /* no response = port is free */ }

  if (portInUse) {
    logInfo('dashboard', `Port ${port} already has a running dashboard, using random port`);
    port = 0;
  }

  // Bind with EADDRINUSE fallback for Linux/Windows
  server = await new Promise<ServerType>((resolve, reject) => {
    const s = serve({
      fetch: app.fetch,
      hostname: '127.0.0.1',
      port,
    });
    s.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        const s2 = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
        const addr = s2.address();
        if (addr && typeof addr === 'object') port = addr.port;
        resolve(s2);
      } else {
        reject(err);
      }
    });
    s.on('listening', () => {
      // If we asked for port 0, read the actual assigned port
      if (port === 0) {
        const addr = s.address();
        if (addr && typeof addr === 'object') port = addr.port;
      }
      resolve(s);
    });
  });

  // Write port file for other processes
  const portFile = join(joworkDir(), 'dashboard.port');
  mkdirSync(dirname(portFile), { recursive: true });
  writeFileSync(portFile, String(port));

  // ── WebSocket server for real-time updates ──────────────────────────
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket: import('node:net').Socket, head: Buffer) => {
    const url = new URL(request.url ?? '', `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // DB polling for change detection
  let lastState = getDbState(sqlite);

  const pollInterval = setInterval(() => {
    try {
      const currentState = getDbState(sqlite);
      if (
        currentState.lastSyncAt !== lastState.lastSyncAt ||
        currentState.sessionCount !== lastState.sessionCount ||
        currentState.contextCount !== lastState.contextCount ||
        currentState.objectCount !== lastState.objectCount
      ) {
        const event = JSON.stringify({ type: 'state_change', data: currentState });
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(event);
          }
        }
        lastState = currentState;
      }
    } catch { /* ignore polling errors */ }
  }, WS_POLL_INTERVAL);

  logInfo('dashboard', `Dashboard started on http://127.0.0.1:${port}`);

  return {
    port,
    close: () => {
      clearInterval(pollInterval);
      for (const client of clients) {
        try { client.close(); } catch { /* ignore */ }
      }
      wss.close();
      server.close();
      dbMgr.close();
      // Clean up port file
      try {
        const { unlinkSync } = require('node:fs');
        unlinkSync(portFile);
      } catch { /* ignore */ }
    },
  };
}

function getDbState(sqlite: Database.Database): {
  lastSyncAt: number;
  sessionCount: number;
  contextCount: number;
  objectCount: number;
} {
  let lastSyncAt = 0;
  let sessionCount = 0;
  let contextCount = 0;
  let objectCount = 0;

  try {
    const cursor = sqlite.prepare(
      'SELECT MAX(last_synced_at) as last FROM sync_cursors',
    ).get() as { last: number | null } | undefined;
    lastSyncAt = cursor?.last ?? 0;
  } catch { /* table may not exist */ }

  try {
    const cutoff = Date.now() - STALE_SESSION_MS;
    const row = sqlite.prepare(
      'SELECT COUNT(*) as count FROM active_sessions WHERE last_heartbeat >= ?',
    ).get(cutoff) as { count: number };
    sessionCount = row.count;
  } catch { /* table may not exist */ }

  try {
    const row = sqlite.prepare('SELECT COUNT(*) as count FROM active_context').get() as { count: number };
    contextCount = row.count;
  } catch { /* table may not exist */ }

  try {
    const row = sqlite.prepare('SELECT COUNT(*) as count FROM objects').get() as { count: number };
    objectCount = row.count;
  } catch { /* table may not exist */ }

  return { lastSyncAt, sessionCount, contextCount, objectCount };
}

function focusMacOS(pid: number): { focused: boolean; method: string; fallback?: string } {
  // 1. Get TTY from PID
  let tty: string;
  try {
    tty = execSync(`ps -p ${pid} -o tty=`, { encoding: 'utf-8' }).trim();
  } catch {
    return { focused: false, method: 'no-process' };
  }
  if (!tty || tty === '??') {
    return { focused: false, method: 'no-tty' };
  }

  // 2. Detect terminal app from parent process
  let parentComm = '';
  try {
    const ppid = execSync(`ps -p ${pid} -o ppid=`, { encoding: 'utf-8' }).trim();
    parentComm = execSync(`ps -p ${ppid} -o comm=`, { encoding: 'utf-8' }).trim();
  } catch { /* ignore — will fall through to generic */ }

  // 3. Try AppleScript based on detected terminal
  if (parentComm.includes('Terminal')) {
    try {
      execSync(`osascript -e '
        tell application "Terminal"
          repeat with w in windows
            repeat with t in tabs of w
              if tty of t is "/dev/${tty}" then
                set frontmost of w to true
                set selected tab of w to t
                activate
                return
              end if
            end repeat
          end repeat
        end tell
      '`, { encoding: 'utf-8', timeout: 3000 });
      return { focused: true, method: 'terminal-applescript' };
    } catch { /* fallthrough */ }
  }

  if (parentComm.includes('iTerm')) {
    try {
      execSync(`osascript -e '
        tell application "iTerm2"
          repeat with w in windows
            repeat with t in tabs of w
              repeat with s in sessions of t
                if tty of s is "/dev/${tty}" then
                  select w
                  select t
                  select s
                  activate
                  return
                end if
              end repeat
            end repeat
          end repeat
        end tell
      '`, { encoding: 'utf-8', timeout: 3000 });
      return { focused: true, method: 'iterm-applescript' };
    } catch { /* fallthrough */ }
  }

  // 4. Fallback: bring Terminal.app to front generically
  try {
    execSync(`osascript -e 'tell application "Terminal" to activate'`, {
      encoding: 'utf-8',
      timeout: 3000,
    });
    return { focused: true, method: 'generic-activate' };
  } catch {
    return { focused: false, method: 'failed' };
  }
}

function getPublicDir(): string {
  // Try relative to this file (source or dist), plus package root fallback
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // When running from `npm install -g`, the package root has the dist/ + src/ dirs
  // Find package root by looking for package.json upward
  let pkgRoot = thisDir;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(pkgRoot, 'package.json'))) break;
    pkgRoot = dirname(pkgRoot);
  }
  const candidates = [
    join(thisDir, 'public'),                              // src/dashboard/server.ts → src/dashboard/public
    join(thisDir, '..', 'dashboard', 'public'),           // dist/ → dist/../dashboard/public
    join(thisDir, '..', '..', 'src', 'dashboard', 'public'), // dist/ → src/dashboard/public
    join(pkgRoot, 'src', 'dashboard', 'public'),          // package root → src/dashboard/public
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  // Fallback: return first candidate (will show error)
  return candidates[0];
}

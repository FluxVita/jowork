import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { like, eq, or, desc } from 'drizzle-orm';
import { objects, objectBodies, connectorConfigs, memories, createId, buildFtsQuery, detectSourceFromQuery } from '@jowork/core';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logInfo, logError } from '../utils/logger.js';
import { GoalManager } from '../goals/manager.js';

export interface McpServerOptions {
  dbPath: string;
}

/**
 * Canonical list of all tool names exposed by JoWork MCP server.
 * Used by inject/registration code — never duplicate tool names manually.
 */
export const JOWORK_MCP_TOOLS = [
  'search_data',
  'list_sources',
  'fetch_content',
  'fetch_doc_map',
  'fetch_chunk',
  'read_memory',
  'write_memory',
  'search_memory',
  'get_environment',
  'get_goals',
  'get_metrics',
  'update_goal',
  'push_to_channel',
] as const;

/** Escape SQL LIKE wildcards so user input is matched literally. */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}

/**
 * Escape FTS5 special operators from user query.
 * FTS5 treats AND, OR, NOT, NEAR as operators and * as wildcard prefix.
 * Wrapping each token in double quotes makes them literal.
 */
function escapeFtsQuery(query: string): string {
  // Split into tokens, quote any that look like FTS operators or contain special chars
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (/^(AND|OR|NOT|NEAR)$/i.test(token) || /[*"(){}:^~\-+[\]]/g.test(token)) {
        return `"${token.replace(/"/g, '""')}"`;
      }
      return token;
    })
    .join(' ');
}

const MAX_MEMORIES = 100;

// ── Push rate limiter ──────────────────────────────────────────────────
const pushRateTracker = new Map<string, number[]>();
const PUSH_RATE_LIMIT = 5; // max per minute
const PUSH_RATE_WINDOW = 60_000; // 1 minute

function checkPushRateLimit(channel: string): boolean {
  const now = Date.now();
  const timestamps = pushRateTracker.get(channel) ?? [];
  const recent = timestamps.filter(t => now - t < PUSH_RATE_WINDOW);
  if (recent.length >= PUSH_RATE_LIMIT) return false;
  recent.push(now);
  pushRateTracker.set(channel, recent);
  return true;
}

export function createJoWorkMcpServer(opts: McpServerOptions): McpServer {
  const sqlite = new Database(opts.dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  const goalManager = new GoalManager(sqlite);

  const server = new McpServer({ name: 'jowork', version: '0.1.0' });

  server.server.onclose = () => {
    try { sqlite.close(); } catch { /* already closed */ }
  };

  // ── Data Tools ────────────────────────────────────────────────────────

  server.tool(
    'search_data',
    {
      query: z.string().describe('Keywords to search -- works like grep across all synced data'),
      source: z.string().optional().describe('Filter by data source: github, feishu, gitlab, notion, slack, local'),
      limit: z.number().optional().default(20).describe('Max results (default 20)'),
    },
    async ({ query, source, limit }) => {
      const t0 = Date.now();
      // Auto-detect source from query if not explicitly provided
      if (!source) {
        source = detectSourceFromQuery(query) ?? undefined;
      }
      // Build FTS match query (null if CJK-only -> skip FTS, go straight to LIKE)
      const ftsMatchQuery = buildFtsQuery(query);

      // Try FTS first (only if we have usable Latin tokens)
      if (ftsMatchQuery) {
        try {
          const ftsQuery = source
            ? `SELECT o.id, o.title, o.summary, o.source, o.source_type, o.uri, o.tags
               FROM objects_fts JOIN objects o ON o.rowid = objects_fts.rowid
               WHERE objects_fts MATCH ? AND o.source = ? LIMIT ?`
            : `SELECT o.id, o.title, o.summary, o.source, o.source_type, o.uri, o.tags
               FROM objects_fts JOIN objects o ON o.rowid = objects_fts.rowid
               WHERE objects_fts MATCH ? LIMIT ?`;
          const ftsArgs = source ? [ftsMatchQuery, source, limit] : [ftsMatchQuery, limit];
          const ftsResults = sqlite.prepare(ftsQuery).all(...ftsArgs);

          if (ftsResults.length > 0) {
            logInfo('mcp', `search_data: "${query}" (FTS)`, { source, resultCount: ftsResults.length, ms: Date.now() - t0 });
            const resultText = JSON.stringify(ftsResults, null, 2);
            const hint = ftsResults.length >= 3
              ? `\n\nShowing ${ftsResults.length} results (summaries only). Use fetch_content with a specific URI to get full content.`
              : '';
            return { content: [{ type: 'text' as const, text: resultText + hint }] };
          }
        } catch { /* FTS unavailable, fallback to LIKE */ }
      }

      // LIKE fallback
      const cleanedQuery = query
        .replace(/飞书|feishu|lark|github|gitlab|notion|slack/gi, '')
        .replace(/群里|最近|在|讨论|什么|话题|有哪些|是什么|怎么样|帮我|告诉我|查一下/g, '')
        .trim();

      let rows: unknown[] = [];
      if (source && cleanedQuery.length >= 2) {
        const segments = cleanedQuery.split(/\s+/).filter((s) => s.length >= 2);
        if (segments.length > 0) {
          const conditions = segments.map(() => '(title LIKE ? OR summary LIKE ? OR tags LIKE ?)').join(' OR ');
          const params: unknown[] = [];
          for (const seg of segments) {
            const p = `%${escapeLike(seg)}%`;
            params.push(p, p, p);
          }
          params.push(source, limit);
          rows = sqlite.prepare(`
            SELECT id, title, summary, source, source_type, uri, tags FROM objects
            WHERE (${conditions}) AND source = ? ORDER BY last_synced_at DESC LIMIT ?
          `).all(...params);
        } else {
          rows = [];
        }
      } else if (source) {
        rows = sqlite.prepare(`
          SELECT id, title, summary, source, source_type, uri, tags FROM objects
          WHERE source = ? ORDER BY last_synced_at DESC LIMIT ?
        `).all(source, limit);
      } else if (cleanedQuery.length >= 2) {
        const pattern = `%${escapeLike(cleanedQuery)}%`;
        rows = sqlite.prepare(`
          SELECT id, title, summary, source, source_type, uri, tags FROM objects
          WHERE title LIKE ? OR summary LIKE ? OR tags LIKE ? OR source LIKE ? OR source_type LIKE ?
          ORDER BY last_synced_at DESC LIMIT ?
        `).all(pattern, pattern, pattern, pattern, pattern, limit);
      } else {
        rows = [];
      }

      logInfo('mcp', `search_data: "${query}"`, { source, resultCount: rows.length, ms: Date.now() - t0 });
      const resultText = JSON.stringify(rows, null, 2);
      const hint = rows.length >= 3
        ? `\n\nShowing ${rows.length} results (summaries only). Use fetch_content with a specific URI to get full content.`
        : '';
      return { content: [{ type: 'text' as const, text: resultText + hint }] };
    },
  );

  server.tool(
    'list_sources',
    {},
    async () => {
      const sources = db.select().from(connectorConfigs).all();
      const counts = sqlite.prepare(
        `SELECT source, COUNT(*) as count FROM objects GROUP BY source`,
      ).all() as Array<{ source: string; count: number }>;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ connectors: sources, objectCounts: counts }, null, 2) }],
      };
    },
  );

  server.tool(
    'fetch_content',
    {
      uri: z.string().describe('Object URI from search_data results'),
    },
    async ({ uri }) => {
      const obj = db.select().from(objects).where(eq(objects.uri, uri)).get();
      if (!obj) {
        return { content: [{ type: 'text' as const, text: `Object not found: ${uri}` }] };
      }
      const body = db.select().from(objectBodies).where(eq(objectBodies.objectId, obj.id)).get();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ...obj, body: body?.content ?? null, contentType: body?.contentType ?? null }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'fetch_doc_map',
    {
      id: z.string().describe('Object ID from search_data results'),
    },
    async ({ id }) => {
      const row = sqlite.prepare(`SELECT doc_map, title FROM objects WHERE id = ?`).get(id) as { doc_map: string | null; title: string } | undefined;
      if (!row) return { content: [{ type: 'text' as const, text: `Object not found: ${id}` }] };
      if (!row.doc_map) {
        return { content: [{ type: 'text' as const, text: `"${row.title}" has no document map (too small). Use fetch_content instead.` }] };
      }
      return { content: [{ type: 'text' as const, text: row.doc_map }] };
    },
  );

  server.tool(
    'fetch_chunk',
    {
      id: z.string().describe('Object ID'),
      idx: z.number().describe('Chunk index (0-based, see fetch_doc_map output for available indices)'),
    },
    async ({ id, idx }) => {
      const chunk = sqlite.prepare(
        `SELECT heading, content, tokens FROM object_chunks WHERE object_id = ? AND idx = ?`,
      ).get(id, idx) as { heading: string | null; content: string; tokens: number } | undefined;
      if (!chunk) {
        return { content: [{ type: 'text' as const, text: 'Chunk not found. Call fetch_doc_map first to see available chunks.' }] };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ heading: chunk.heading, tokens: chunk.tokens, content: chunk.content }, null, 2) }],
      };
    },
  );

  // ── Memory Tools ──────────────────────────────────────────────────────

  server.tool(
    'read_memory',
    {
      query: z.string().describe('Search keywords -- matches against title, content, and tags'),
      limit: z.number().optional().default(10).describe('Max results'),
    },
    async ({ query, limit }) => {
      const pattern = `%${escapeLike(query)}%`;
      const rows = db.select().from(memories)
        .where(or(like(memories.title, pattern), like(memories.content, pattern), like(memories.tags, pattern)))
        .orderBy(desc(memories.updatedAt))
        .limit(limit).all()
        .filter((r) => r.scope === 'personal' || process.env['JOWORK_MODE'] === 'team');

      // Batch update access tracking in a single transaction
      const now = Date.now();
      const touchMemory = sqlite.prepare('UPDATE memories SET last_used_at = ?, access_count = access_count + 1 WHERE id = ?');
      sqlite.transaction(() => {
        for (const row of rows) touchMemory.run(now, row.id);
      })();

      const results = rows.map((r) => ({
        id: r.id, title: r.title, content: r.content,
        tags: r.tags ? JSON.parse(r.tags) : [], scope: r.scope, pinned: r.pinned === 1,
      }));

      if (results.length === 0) return { content: [{ type: 'text' as const, text: `No memories found for: ${query}` }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    'write_memory',
    {
      title: z.string().describe('Short descriptive title for the memory'),
      content: z.string().describe('Memory content -- what to remember'),
      tags: z.array(z.string()).optional().describe('Tags for categorization (e.g. ["decision", "preference"])'),
      scope: z.enum(['personal', 'team']).optional().default('personal').describe('Scope'),
    },
    async ({ title, content, tags, scope }) => {
      const now = Date.now();
      const id = createId('mem');
      db.insert(memories).values({
        id, title, content, tags: JSON.stringify(tags ?? []),
        scope, pinned: 0, source: 'auto', lastUsedAt: null, createdAt: now, updatedAt: now,
      }).run();

      // Maintain FTS index
      try {
        const rowid = sqlite.prepare('SELECT rowid FROM memories WHERE id = ?').get(id) as { rowid: number } | undefined;
        if (rowid) {
          sqlite.prepare(
            'INSERT INTO memories_fts(rowid, title, content, tags) VALUES (?, ?, ?, ?)',
          ).run(rowid.rowid, title, content, JSON.stringify(tags ?? []));
        }
      } catch {
        // FTS maintenance is non-critical
      }

      // Auto-truncate: keep at most MAX_MEMORIES, delete oldest unpinned
      try {
        const count = sqlite.prepare('SELECT COUNT(*) AS c FROM memories').get() as { c: number };
        if (count.c > MAX_MEMORIES) {
          const excess = count.c - MAX_MEMORIES;
          const toDelete = sqlite.prepare(
            `SELECT id, rowid, title, content, tags FROM memories WHERE pinned = 0 ORDER BY updated_at ASC LIMIT ?`,
          ).all(excess) as Array<{ id: string; rowid: number; title: string; content: string; tags: string }>;
          for (const row of toDelete) {
            // Remove from FTS
            try {
              sqlite.prepare(
                `INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES ('delete', ?, ?, ?, ?)`,
              ).run(row.rowid, row.title, row.content, row.tags ?? '');
            } catch { /* non-critical */ }
            sqlite.prepare('DELETE FROM memories WHERE id = ?').run(row.id);
          }
          logInfo('mcp', `write_memory: auto-truncated ${toDelete.length} old memories (cap: ${MAX_MEMORIES})`);
        }
      } catch {
        // Truncation is non-critical
      }

      logInfo('mcp', `write_memory: "${title}"`, { id, tags, scope });
      return { content: [{ type: 'text' as const, text: `Memory saved: "${title}" (id: ${id})` }] };
    },
  );

  server.tool(
    'search_memory',
    {
      query: z.string().describe('Search query -- uses full-text search with time-weighted ranking'),
      limit: z.number().optional().default(10).describe('Max results'),
    },
    async ({ query, limit }) => {
      const t0 = Date.now();
      const escapedQuery = escapeFtsQuery(query);

      // Try FTS first
      let results: Array<Record<string, unknown>> = [];
      try {
        const ftsRows = sqlite.prepare(`
          SELECT m.id, m.title, m.content, m.tags, m.scope, m.pinned,
                 m.access_count, m.last_used_at, m.created_at, m.updated_at,
                 rank
          FROM memories_fts f
          JOIN memories m ON m.rowid = f.rowid
          WHERE memories_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(escapedQuery, limit) as Array<{
          id: string; title: string; content: string; tags: string;
          scope: string; pinned: number; access_count: number;
          last_used_at: number | null; created_at: number; updated_at: number;
          rank: number;
        }>;

        if (ftsRows.length > 0) {
          // Time-weighted re-ranking: boost recently used/updated memories
          const now = Date.now();
          const scored = ftsRows.map((r) => {
            const recency = r.last_used_at
              ? Math.max(0, 1 - (now - r.last_used_at) / (30 * 24 * 60 * 60 * 1000)) // decay over 30 days
              : 0;
            const accessBoost = Math.min(r.access_count * 0.05, 0.5);
            const pinnedBoost = r.pinned ? 0.3 : 0;
            const score = -r.rank + recency * 2 + accessBoost + pinnedBoost;
            return { ...r, score };
          });
          scored.sort((a, b) => b.score - a.score);

          results = scored.map((r) => ({
            id: r.id, title: r.title, content: r.content,
            tags: r.tags ? JSON.parse(r.tags) : [], scope: r.scope,
            pinned: r.pinned === 1, accessCount: r.access_count,
          }));
        }
      } catch {
        // FTS unavailable, fall through to LIKE
      }

      // LIKE fallback
      if (results.length === 0) {
        const pattern = `%${escapeLike(query)}%`;
        const likeRows = db.select().from(memories)
          .where(or(like(memories.title, pattern), like(memories.content, pattern), like(memories.tags, pattern)))
          .orderBy(desc(memories.updatedAt))
          .limit(limit).all();

        results = likeRows.map((r) => ({
          id: r.id, title: r.title, content: r.content,
          tags: r.tags ? JSON.parse(r.tags) : [], scope: r.scope,
          pinned: r.pinned === 1, accessCount: r.accessCount,
        }));
      }

      // Batch touch accessed memories in a single transaction
      const now = Date.now();
      const touchMem = sqlite.prepare('UPDATE memories SET last_used_at = ?, access_count = access_count + 1 WHERE id = ?');
      sqlite.transaction(() => {
        for (const r of results) touchMem.run(now, r.id);
      })();

      logInfo('mcp', `search_memory: "${query}"`, { resultCount: results.length, ms: Date.now() - t0 });
      if (results.length === 0) return { content: [{ type: 'text' as const, text: `No memories found for: ${query}` }] };
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  // ── System Tools ──────────────────────────────────────────────────────

  server.tool(
    'get_environment',
    {},
    async () => {
      const now = new Date();
      const info: Record<string, string> = {
        datetime: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        timezone: 'Asia/Shanghai',
        platform: process.platform, arch: process.arch,
        nodeVersion: process.version,
        uptime: `${Math.round(process.uptime() / 60)} min`,
        memoryUsage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB heap`,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] };
    },
  );

  // ── MCP Resources ───────────────────────────────────────────────────

  server.resource(
    'connectors',
    'jowork://connectors',
    async (uri) => {
      const sources = db.select().from(connectorConfigs).all();
      const counts = sqlite.prepare(
        `SELECT source, COUNT(*) as count FROM objects GROUP BY source`,
      ).all() as Array<{ source: string; count: number }>;
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ connectors: sources, objectCounts: counts }, null, 2),
        }],
      };
    },
  );

  server.resource(
    'memories',
    'jowork://memories',
    async (uri) => {
      const mems = sqlite.prepare(
        `SELECT id, title, tags, scope, pinned, access_count, updated_at FROM memories ORDER BY updated_at DESC LIMIT 50`,
      ).all();
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(mems, null, 2),
        }],
      };
    },
  );

  server.resource(
    'status',
    'jowork://status',
    async (uri) => {
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
      // Last sync info
      let lastSync: { connector: string; at: string } | null = null;
      try {
        const cursor = sqlite.prepare(
          `SELECT connector_id, last_synced_at FROM sync_cursors ORDER BY last_synced_at DESC LIMIT 1`,
        ).get() as { connector_id: string; last_synced_at: number } | undefined;
        if (cursor) lastSync = { connector: cursor.connector_id, at: new Date(cursor.last_synced_at).toISOString() };
      } catch { /* no cursors */ }
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ tableCounts: counts, lastSync }, null, 2),
        }],
      };
    },
  );

  server.resource(
    'goals',
    'jowork://goals',
    async (uri) => {
      try {
        const goals = sqlite.prepare(
          `SELECT g.*, (SELECT COUNT(*) FROM signals WHERE goal_id = g.id) as signal_count
           FROM goals g WHERE g.status = 'active' ORDER BY g.created_at DESC`,
        ).all();
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(goals, null, 2),
          }],
        };
      } catch {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: '[]' }] };
      }
    },
  );

  // ── Goal Tools ──────────────────────────────────────────────────────

  server.tool(
    'get_goals',
    {
      status: z.string().optional().describe('Filter: active, paused, completed'),
    },
    async ({ status }) => {
      const goals = goalManager.listGoals({ status });
      return { content: [{ type: 'text' as const, text: JSON.stringify(goals, null, 2) }] };
    },
  );

  server.tool(
    'get_metrics',
    {
      goal_id: z.string().optional().describe('Goal ID (shows all active if omitted)'),
    },
    async ({ goal_id }) => {
      const query = goal_id
        ? `SELECT s.*, m.threshold, m.comparison, m.current, m.met, g.title as goal_title
           FROM signals s
           JOIN goals g ON g.id = s.goal_id
           LEFT JOIN measures m ON m.signal_id = s.id
           WHERE s.goal_id = ? ORDER BY s.created_at`
        : `SELECT s.*, m.threshold, m.comparison, m.current, m.met, g.title as goal_title
           FROM signals s
           JOIN goals g ON g.id = s.goal_id AND g.status = 'active'
           LEFT JOIN measures m ON m.signal_id = s.id
           ORDER BY g.created_at DESC, s.created_at`;
      const rows = sqlite.prepare(query).all(...(goal_id ? [goal_id] : []));
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
    },
  );

  server.tool(
    'update_goal',
    {
      goal_id: z.string().describe('Goal ID'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description'),
      status: z.enum(['active', 'paused', 'completed']).optional().describe('New status'),
    },
    async ({ goal_id, title, description, status }) => {
      const existing = goalManager.getGoal(goal_id);
      if (!existing) return { content: [{ type: 'text' as const, text: `Goal not found: ${goal_id}` }] };

      // Copilot mode requires human confirmation before changes
      if (existing.autonomyLevel === 'copilot') {
        const proposed = { goal_id, title, description, status };
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'pending_confirmation',
              message: `Goal "${existing.title}" is in copilot mode. Proposed changes need human approval.`,
              proposed_changes: Object.fromEntries(Object.entries(proposed).filter(([_, v]) => v !== undefined)),
              current: existing,
              hint: 'To apply, update the goal autonomy_level to "semipilot" or "autopilot", or ask the user to confirm.',
            }, null, 2),
          }],
        };
      }

      const updated = goalManager.updateGoal(goal_id, {
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        ...(status ? { status: status as 'active' | 'paused' | 'completed' } : {}),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] };
    },
  );

  server.tool(
    'push_to_channel',
    {
      channel: z.string().describe('Channel: feishu, slack, telegram'),
      target: z.string().describe('Target ID (chat_id for feishu, channel for slack)'),
      message: z.string().describe('Message content'),
    },
    async ({ channel, target, message }) => {
      if (!checkPushRateLimit(`${channel}:${target}`)) {
        return { content: [{ type: 'text' as const, text: `Rate limited: max ${PUSH_RATE_LIMIT} pushes per minute per target. Try again shortly.` }] };
      }
      logInfo('mcp', `push_to_channel: ${channel}/${target}`, { length: message.length });

      if (channel === 'feishu') {
        // Try to send via Feishu API
        try {
          const credFile = join(process.env['HOME'] ?? '', '.jowork', 'credentials', 'feishu.json');
          if (!existsSync(credFile)) {
            return { content: [{ type: 'text' as const, text: 'Feishu not connected. Run `jowork connect feishu` first.' }] };
          }
          const cred = JSON.parse(readFileSync(credFile, 'utf-8'));
          const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: cred.data.appId, app_secret: cred.data.appSecret }),
          });
          const tokenData = await tokenRes.json() as { code: number; tenant_access_token: string };
          if (tokenData.code !== 0) return { content: [{ type: 'text' as const, text: `Feishu auth failed: ${tokenData.code}` }] };

          const msgRes = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenData.tenant_access_token}` },
            body: JSON.stringify({
              receive_id: target,
              msg_type: 'text',
              content: JSON.stringify({ text: message }),
            }),
          });
          const msgData = await msgRes.json() as { code: number };
          if (msgData.code !== 0) return { content: [{ type: 'text' as const, text: `Feishu send failed: ${msgData.code}` }] };

          logInfo('mcp', `push_to_channel: feishu/${target}`, { length: message.length });
          return { content: [{ type: 'text' as const, text: `✓ Message sent to Feishu chat ${target}` }] };
        } catch (err) {
          return { content: [{ type: 'text' as const, text: `Error: ${err}` }] };
        }
      }
      return { content: [{ type: 'text' as const, text: `Channel "${channel}" not yet supported. Available: feishu` }] };
    },
  );

  return server;
}

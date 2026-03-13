import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { like, eq, or, desc } from 'drizzle-orm';
import { objects, objectBodies, connectorConfigs, memories } from '@jowork/core';
import { createId } from '@jowork/core';

export interface McpServerOptions {
  dbPath: string;
}

/** Escape SQL LIKE wildcards so user input is matched literally. */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}

export function createJoWorkMcpServer(opts: McpServerOptions): McpServer {
  const sqlite = new Database(opts.dbPath);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite);

  const server = new McpServer({ name: 'jowork', version: '0.0.1' });

  // Ensure DB is closed when server shuts down
  server.server.onclose = () => {
    try { sqlite.close(); } catch { /* already closed */ }
  };

  // search_data — FTS or LIKE search across objects
  server.tool(
    'search_data',
    {
      query: z.string().describe('Search query'),
      source: z.string().optional().describe('Filter by source (github, gitlab, etc.)'),
      limit: z.number().optional().default(20).describe('Max results'),
    },
    async ({ query, source, limit }) => {
      // Try FTS first, fallback to LIKE
      try {
        const ftsQuery = source
          ? `SELECT rowid, title, summary, source, source_type FROM objects_fts WHERE objects_fts MATCH ? AND source = ? LIMIT ?`
          : `SELECT rowid, title, summary, source, source_type FROM objects_fts WHERE objects_fts MATCH ? LIMIT ?`;
        const ftsArgs = source ? [query, source, limit] : [query, limit];
        const ftsResults = sqlite.prepare(ftsQuery).all(...ftsArgs);

        if (ftsResults.length > 0) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(ftsResults, null, 2) }],
          };
        }
      } catch {
        // FTS table may not exist, fallback to LIKE
      }

      // LIKE fallback — escape wildcards in user input
      const pattern = `%${escapeLike(query)}%`;
      let rows;
      if (source) {
        rows = db.select().from(objects)
          .where(or(
            like(objects.title, pattern),
            like(objects.summary, pattern),
          ))
          .limit(limit)
          .all()
          .filter((r) => r.source === source);
      } else {
        rows = db.select().from(objects)
          .where(or(
            like(objects.title, pattern),
            like(objects.summary, pattern),
          ))
          .limit(limit)
          .all();
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }],
      };
    },
  );

  // fetch_content — get full body for an object
  server.tool(
    'fetch_content',
    { uri: z.string().describe('Object URI') },
    async ({ uri }) => {
      const obj = db.select().from(objects).where(eq(objects.uri, uri)).get();
      if (!obj) {
        return { content: [{ type: 'text' as const, text: `Object not found: ${uri}` }] };
      }
      const body = db.select().from(objectBodies).where(eq(objectBodies.objectId, obj.id)).get();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ...obj,
            body: body?.content ?? null,
            contentType: body?.contentType ?? null,
          }, null, 2),
        }],
      };
    },
  );

  // list_sources — list connected data sources
  server.tool(
    'list_sources',
    {},
    async () => {
      const sources = db.select().from(connectorConfigs).all();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(sources, null, 2) }],
      };
    },
  );

  // notify — send desktop notification
  // In standalone MCP mode (subprocess), we can't access Electron Notification API.
  // The main process handles real notifications via IPC NotificationManager.
  server.tool(
    'notify',
    {
      title: z.string().describe('Notification title'),
      body: z.string().describe('Notification body'),
    },
    async ({ title, body }) => {
      return { content: [{ type: 'text' as const, text: `Notification queued: ${title} — ${body}` }] };
    },
  );

  // read_memory — search user memories by query
  server.tool(
    'read_memory',
    {
      query: z.string().describe('Search query for memories (searches title, content, and tags)'),
      limit: z.number().optional().default(10).describe('Max results'),
    },
    async ({ query, limit }) => {
      const pattern = `%${escapeLike(query)}%`;
      const rows = db.select().from(memories)
        .where(or(
          like(memories.title, pattern),
          like(memories.content, pattern),
          like(memories.tags, pattern),
        ))
        .orderBy(desc(memories.updatedAt))
        .limit(limit)
        .all();

      // Touch lastUsedAt for returned memories
      const now = Date.now();
      for (const row of rows) {
        db.update(memories).set({ lastUsedAt: now }).where(eq(memories.id, row.id)).run();
      }

      const results = rows.map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        tags: r.tags ? JSON.parse(r.tags) : [],
        scope: r.scope,
        pinned: r.pinned === 1,
      }));

      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `No memories found for: ${query}` }] };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  // write_memory — create or update a memory
  server.tool(
    'write_memory',
    {
      title: z.string().describe('Memory title'),
      content: z.string().describe('Memory content'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
      scope: z.enum(['personal', 'team']).optional().default('personal').describe('Memory scope'),
    },
    async ({ title, content, tags, scope }) => {
      const now = Date.now();
      const id = createId('mem');
      db.insert(memories).values({
        id,
        title,
        content,
        tags: JSON.stringify(tags ?? []),
        scope,
        pinned: 0,
        source: 'auto',
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      }).run();

      return {
        content: [{ type: 'text' as const, text: `Memory saved: "${title}" (id: ${id})` }],
      };
    },
  );

  // send_message — send message via connector
  // In standalone MCP mode (subprocess), ConnectorHub is not accessible.
  // This tool is functional only when the MCP server runs in-process with Electron.
  server.tool(
    'send_message',
    {
      channel: z.string().describe('Channel ID or connector name (e.g. "feishu", "slack")'),
      message: z.string().describe('Message content'),
    },
    async ({ channel, message }) => {
      return {
        content: [{
          type: 'text' as const,
          text: `Message to "${channel}" queued (${message.length} chars). Note: Direct connector messaging requires the JoWork desktop app to be running.`,
        }],
      };
    },
  );

  return server;
}

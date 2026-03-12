import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { like, eq, or } from 'drizzle-orm';
import { objects, objectBodies, connectorConfigs } from '@jowork/core';

export interface McpServerOptions {
  dbPath: string;
}

export function createJoWorkMcpServer(opts: McpServerOptions): McpServer {
  const sqlite = new Database(opts.dbPath, { readonly: true });
  const db = drizzle(sqlite);

  const server = new McpServer({ name: 'jowork', version: '0.0.1' });

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

      // LIKE fallback
      const pattern = `%${query}%`;
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

  // notify — send desktop notification (placeholder, real impl needs Electron Notification)
  server.tool(
    'notify',
    {
      title: z.string().describe('Notification title'),
      body: z.string().describe('Notification body'),
    },
    async ({ title, body }) => {
      // In standalone mode, just log. In Electron main process, would use Notification API.
      console.log(`[notify] ${title}: ${body}`);
      return { content: [{ type: 'text' as const, text: `Notification sent: ${title}` }] };
    },
  );

  // Placeholders for Phase 3+ tools
  server.tool(
    'read_memory',
    { query: z.string().describe('Search query for memories') },
    async () => {
      return { content: [{ type: 'text' as const, text: 'Memory system available in Phase 3' }] };
    },
  );

  server.tool(
    'write_memory',
    {
      title: z.string().describe('Memory title'),
      content: z.string().describe('Memory content'),
    },
    async () => {
      return { content: [{ type: 'text' as const, text: 'Memory system available in Phase 3' }] };
    },
  );

  server.tool(
    'send_message',
    {
      channel: z.string().describe('Channel ID or name'),
      message: z.string().describe('Message content'),
    },
    async () => {
      return { content: [{ type: 'text' as const, text: 'Messaging available in Phase 5' }] };
    },
  );

  return server;
}

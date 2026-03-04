// @jowork/core/agent/tools — basic tool definitions for the builtin engine

import { searchMemory } from '../../memory/index.js';
import { getDb } from '../../datamap/db.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export interface ToolContext {
  userId: string;
  agentId: string;
}

/** Basic memory search */
const searchMemoryTool: ToolDefinition = {
  name: 'search_memory',
  description: "Search the user's memory for relevant information",
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords to search for' },
    },
    required: ['query'],
  },
  async execute(input, ctx) {
    const query = input['query'] as string;
    const results = searchMemory({ query, userId: ctx.userId, limit: 10 });
    if (results.length === 0) return 'No relevant memories found.';
    return results.map(m => `- ${m.content}`).join('\n');
  },
};

/** List configured connectors */
const listConnectorsTool: ToolDefinition = {
  name: 'list_connectors',
  description: 'List configured data source connectors',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input, ctx) {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, kind, name FROM connectors WHERE owner_id = ?`,
    ).all(ctx.userId) as Array<{ id: string; kind: string; name: string }>;
    if (rows.length === 0) return 'No connectors configured.';
    return rows.map(r => `${r.name} (${r.kind}, id=${r.id})`).join('\n');
  },
};

export const BUILTIN_TOOLS: ToolDefinition[] = [
  searchMemoryTool,
  listConnectorsTool,
];

// @jowork/core/agent/tools — built-in tool definitions for the builtin engine
//
// Tools available to all agents:
//   search_memory      — full-text search the user's long-term memory
//   create_memory      — save a new fact to long-term memory
//   list_connectors    — list configured data source connectors
//   fetch_connector    — retrieve an item from a connector by ID
//   search_connector   — search a connector for matching items
//   list_context       — list context documents (workstyle, rules, etc.)

import { searchMemory, saveMemory } from '../../memory/index.js';
import { listContextDocs } from '../../context/index.js';
import { getConnector, getConnectorConfig, listConnectorConfigs } from '../../connectors/index.js';
import { ForbiddenError, type ConnectorId, type ConnectorKind } from '../../types.js';

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

/**
 * Guard: if the input contains a userId field that differs from ctx.userId,
 * throw ForbiddenError — agent must not access another user's data.
 */
function assertSameUser(input: Record<string, unknown>, ctx: ToolContext): void {
  const requested = input['userId'] ?? input['user_id'];
  if (requested !== undefined && requested !== ctx.userId) {
    throw new ForbiddenError('access another user\'s data');
  }
}

// ─── Tool: search_memory ─────────────────────────────────────────────────────

const searchMemoryTool: ToolDefinition = {
  name: 'search_memory',
  description: "Search the user's long-term memory for relevant facts or information",
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords or phrase to search for' },
    },
    required: ['query'],
  },
  async execute(input, ctx) {
    assertSameUser(input, ctx);
    const query = input['query'] as string;
    const results = searchMemory({ query, userId: ctx.userId, limit: 10 });
    if (results.length === 0) return 'No relevant memories found.';
    return results.map(m => `[${m.id}] ${m.content}`).join('\n');
  },
};

// ─── Tool: create_memory ─────────────────────────────────────────────────────

const createMemoryTool: ToolDefinition = {
  name: 'create_memory',
  description: "Save a new fact or insight to the user's long-term memory",
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The fact or insight to remember' },
      tags:    { type: 'string', description: 'Comma-separated tags for categorization (optional)' },
    },
    required: ['content'],
  },
  async execute(input, ctx) {
    assertSameUser(input, ctx);
    const content = String(input['content'] ?? '').trim();
    if (!content) return 'Error: content cannot be empty.';
    const rawTags = String(input['tags'] ?? '').trim();
    const tags = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const entry = saveMemory(ctx.userId, content, { tags, source: 'agent' });
    return `Memory saved (id=${entry.id}).`;
  },
};

// ─── Tool: list_connectors ────────────────────────────────────────────────────

const listConnectorsTool: ToolDefinition = {
  name: 'list_connectors',
  description: 'List configured data source connectors available to the user',
  inputSchema: { type: 'object', properties: {} },
  async execute(_input, ctx) {
    const rows = listConnectorConfigs(ctx.userId);
    if (rows.length === 0) return 'No connectors configured.';
    return rows.map(r => `${r.name} (kind=${r.kind}, id=${r.id})`).join('\n');
  },
};

// ─── Tool: fetch_connector ────────────────────────────────────────────────────

const fetchConnectorTool: ToolDefinition = {
  name: 'fetch_connector',
  description: 'Retrieve a specific item from a configured connector by item ID or URL',
  inputSchema: {
    type: 'object',
    properties: {
      connector_id: { type: 'string', description: 'The connector config ID (from list_connectors)' },
      item_id:      { type: 'string', description: 'The item ID or URL to fetch' },
    },
    required: ['connector_id', 'item_id'],
  },
  async execute(input, ctx) {
    const connectorId = String(input['connector_id'] ?? '');
    const itemId      = String(input['item_id'] ?? '');

    const cfg = getConnectorConfig(connectorId as ConnectorId);
    if (cfg.ownerId !== ctx.userId) throw new ForbiddenError('access another user\'s connector');

    const c = getConnector(cfg.kind as ConnectorKind);
    if (!c.capabilities.canFetch || !c.fetch) {
      return `Connector '${cfg.kind}' does not support fetch.`;
    }
    try {
      const result = await c.fetch(cfg, itemId);
      return `**${result.title}**\n${result.content}${result.url ? `\nURL: ${result.url}` : ''}`;
    } catch (err) {
      return `Fetch error: ${String(err)}`;
    }
  },
};

// ─── Tool: search_connector ───────────────────────────────────────────────────

const searchConnectorTool: ToolDefinition = {
  name: 'search_connector',
  description: 'Search a configured connector for items matching a query',
  inputSchema: {
    type: 'object',
    properties: {
      connector_id: { type: 'string', description: 'The connector config ID (from list_connectors)' },
      query:        { type: 'string', description: 'Search query text' },
    },
    required: ['connector_id', 'query'],
  },
  async execute(input, ctx) {
    const connectorId = String(input['connector_id'] ?? '');
    const query       = String(input['query'] ?? '');

    const cfg = getConnectorConfig(connectorId as ConnectorId);
    if (cfg.ownerId !== ctx.userId) throw new ForbiddenError('access another user\'s connector');

    const c = getConnector(cfg.kind as ConnectorKind);
    if (!c.capabilities.canSearch || !c.search) {
      return `Connector '${cfg.kind}' does not support search.`;
    }
    try {
      const results = await c.search!(cfg, query);
      if (results.length === 0) return 'No results found.';
      return results.slice(0, 5).map(r => `- **${r.title}**: ${r.content.slice(0, 200)}`).join('\n');
    } catch (err) {
      return `Search error: ${String(err)}`;
    }
  },
};

// ─── Tool: list_context ───────────────────────────────────────────────────────

const listContextTool: ToolDefinition = {
  name: 'list_context',
  description: 'List available context documents (rules, workstyle preferences, reference docs)',
  inputSchema: {
    type: 'object',
    properties: {
      layer: { type: 'string', description: 'Filter by layer: company, team, or personal (optional)' },
    },
  },
  async execute(input, _ctx) {
    const layer = input['layer'] as string | undefined;
    const validLayers = ['company', 'team', 'personal'];
    const docs = listContextDocs(
      layer && validLayers.includes(layer)
        ? { layer: layer as 'company' | 'team' | 'personal' }
        : {},
    );
    if (docs.length === 0) return 'No context documents found.';
    return docs.map(d => `[${d.id}] ${d.title} (layer=${d.layer}): ${d.content.slice(0, 100)}`).join('\n');
  },
};

// ─── Exported tool list + schema helper ──────────────────────────────────────

export const BUILTIN_TOOLS: ToolDefinition[] = [
  searchMemoryTool,
  createMemoryTool,
  listConnectorsTool,
  fetchConnectorTool,
  searchConnectorTool,
  listContextTool,
];

/** Return tool list as JSON Schema descriptors (for UI display or LLM tool_use) */
export function getToolSchemas(): Array<{
  name: string;
  description: string;
  input_schema: ToolDefinition['inputSchema'];
}> {
  return BUILTIN_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

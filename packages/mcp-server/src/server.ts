/**
 * JoWork MCP Server — exposes Gateway tools via MCP protocol.
 *
 * Uses low-level Server API because tool definitions are dynamic
 * (fetched at runtime from Gateway, not static Zod schemas).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { GatewayClient } from './gateway-client.js';

const TOOL_PREFIX = 'jowork_';

export function createMcpServer(gateway: GatewayClient): Server {
  const server = new Server(
    { name: '@jowork/mcp-server', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  // ── tools/list ──
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const edgeTools = await gateway.listTools();
    return {
      tools: edgeTools.map(t => ({
        name: `${TOOL_PREFIX}${t.name}`,
        description: t.description,
        inputSchema: t.input_schema as {
          type: 'object';
          properties?: Record<string, unknown>;
        },
      })),
    };
  });

  // ── tools/call ──
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!name.startsWith(TOOL_PREFIX)) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const toolName = name.slice(TOOL_PREFIX.length);

    try {
      const result = await gateway.executeTool(
        toolName,
        (args ?? {}) as Record<string, unknown>
      );
      return {
        content: [{ type: 'text' as const, text: result }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // ── resources/list ──
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'jowork://health',
        name: 'Gateway Health',
        description: 'JoWork Gateway health status',
        mimeType: 'application/json',
      },
      {
        uri: 'jowork://sources',
        name: 'Data Sources',
        description: 'Connected data sources (Feishu, GitLab, Linear, etc.)',
        mimeType: 'application/json',
      },
    ],
  }));

  // ── resources/read ──
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'jowork://health') {
      const health = await gateway.health();
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(health, null, 2),
        }],
      };
    }

    if (uri === 'jowork://sources') {
      try {
        const result = await gateway.executeTool('list_sources', {});
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: result,
          }],
        };
      } catch {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ error: 'Failed to list sources' }),
          }],
        };
      }
    }

    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: `Unknown resource: ${uri}`,
      }],
    };
  });

  return server;
}

#!/usr/bin/env node

/**
 * @jowork/mcp-server — Entry point
 *
 * Two modes:
 *   1. MCP Server (default): stdio JSON-RPC for Claude Desktop / Cursor / etc.
 *   2. CLI mode (--call): direct tool invocation for OpenClaw / shell scripts.
 *
 * Environment variables:
 *   JOWORK_URL      (required) — Gateway URL, e.g. "https://jowork.work"
 *   JOWORK_TOKEN    (option 1) — JWT token for authentication
 *   JOWORK_USERNAME (option 2) — Username for /api/auth/local
 *   JOWORK_PASSWORD (option 2) — Password (optional if local auth doesn't require it)
 *
 * CLI usage:
 *   jowork-mcp --call <tool_name> [json_args]
 *   jowork-mcp --call search_data '{"query":"Q2 OKR"}'
 *   jowork-mcp --list                              # list available tools
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Auth } from './auth.js';
import { GatewayClient } from './gateway-client.js';
import { createMcpServer } from './server.js';

function log(level: string, ...args: unknown[]): void {
  process.stderr.write(`[jowork-mcp] [${level}] ${args.join(' ')}\n`);
}

function initClient(): { gateway: GatewayClient; gatewayUrl: string } {
  const gatewayUrl = process.env['JOWORK_URL'];
  if (!gatewayUrl) {
    log('Error', 'JOWORK_URL is required. Set it to your JoWork Gateway URL (e.g. https://jowork.work)');
    process.exit(1);
  }

  const token = process.env['JOWORK_TOKEN'];
  const username = process.env['JOWORK_USERNAME'];
  const password = process.env['JOWORK_PASSWORD'];

  if (!token && !username) {
    log('Error', 'Either JOWORK_TOKEN or JOWORK_USERNAME is required for authentication.');
    process.exit(1);
  }

  const auth = new Auth({ gatewayUrl, token, username, password });
  const gateway = new GatewayClient(gatewayUrl, auth);
  return { gateway, gatewayUrl };
}

/** CLI mode: --list */
async function cliList(): Promise<void> {
  const { gateway, gatewayUrl } = initClient();
  await gateway.connect();
  const tools = await gateway.listTools();
  log('Info', `Connected to ${gatewayUrl}, ${tools.length} tools`);

  for (const t of tools) {
    const desc = (t.description || '').split('\n')[0].slice(0, 80);
    process.stdout.write(`${t.name}  ${desc}\n`);
  }
}

/** CLI mode: --call <tool> [json_args] */
async function cliCall(toolName: string, argsJson: string): Promise<void> {
  const { gateway } = initClient();
  await gateway.connect();

  let input: Record<string, unknown> = {};
  if (argsJson) {
    try {
      input = JSON.parse(argsJson);
    } catch {
      log('Error', `Invalid JSON args: ${argsJson}`);
      process.exit(1);
    }
  }

  const result = await gateway.executeTool(toolName, input);
  process.stdout.write(result + '\n');
}

/** MCP Server mode (default) */
async function mcpServer(): Promise<void> {
  const { gateway, gatewayUrl } = initClient();

  try {
    await gateway.connect();
    const tools = await gateway.listTools();
    log('Info', `Connected to ${gatewayUrl}, ${tools.length} tools available`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('Warning', `Cannot connect to Gateway at ${gatewayUrl}: ${msg}`);
    log('Warning', 'Server will start but tools/list will return empty until Gateway is reachable');
  }

  const server = createMcpServer(gateway);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('Info', 'MCP Server running (stdio transport)');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === '--list') {
    await cliList();
  } else if (args[0] === '--call') {
    const toolName = args[1];
    if (!toolName) {
      log('Error', 'Usage: jowork-mcp --call <tool_name> [json_args]');
      process.exit(1);
    }
    await cliCall(toolName, args[2] || '');
  } else if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(`@jowork/mcp-server — JoWork Gateway MCP Server + CLI

Usage:
  jowork-mcp                                  Start MCP server (stdio)
  jowork-mcp --list                           List available tools
  jowork-mcp --call <tool> [json_args]        Call a tool directly
  jowork-mcp --help                           Show this help

Environment:
  JOWORK_URL       Gateway URL (required)
  JOWORK_TOKEN     JWT token (option 1)
  JOWORK_USERNAME  Username for local auth (option 2)
  JOWORK_PASSWORD  Password for local auth (option 2)

Examples:
  jowork-mcp --call search_data '{"query":"Q2 OKR"}'
  jowork-mcp --call lark_list_chats
  jowork-mcp --call fetch_content '{"uri":"feishu://doc/xxx"}'
`);
  } else {
    await mcpServer();
  }
}

main().catch(err => {
  log('Fatal', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

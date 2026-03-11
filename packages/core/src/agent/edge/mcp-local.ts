/**
 * Edge 本地 MCP 支持 — 在 Edge sidecar 中直接运行 MCP 服务器
 *
 * 从 .mcp.json 或 ~/.jowork/mcp.json 加载配置，
 * 复用 McpBridge 类的 JSON-RPC subprocess 逻辑。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { AnthropicToolDef } from '../types.js';

// ─── 轻量级 McpBridge（无 DB 依赖） ───

interface McpServerEntry {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

class EdgeMcpBridge {
  private process: ChildProcess | null = null;
  private entry: McpServerEntry;
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>();
  private buffer = '';
  private initialized = false;

  constructor(entry: McpServerEntry) {
    this.entry = entry;
  }

  async start(): Promise<void> {
    if (this.process) return;

    this.process = spawn(this.entry.command, this.entry.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.entry.env },
      cwd: this.entry.cwd,
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on('data', () => { /* ignore */ });

    this.process.on('exit', () => {
      this.process = null;
      this.initialized = false;
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`MCP server ${this.entry.name} exited`));
      }
      this.pendingRequests.clear();
    });

    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'jowork-edge', version: '1.0.0' },
    });

    this.sendNotification('notifications/initialized', {});
    this.initialized = true;
  }

  async listTools(): Promise<AnthropicToolDef[]> {
    if (!this.initialized) await this.start();
    const result = await this.sendRequest('tools/list', {}) as { tools: McpToolDef[] };
    return (result.tools ?? []).map(t => ({
      name: `mcp_${this.entry.id}_${t.name}`,
      description: `[MCP:${this.entry.name}] ${t.description ?? t.name}`,
      input_schema: t.inputSchema ?? { type: 'object', properties: {} },
    }));
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!this.initialized) await this.start();
    const originalName = toolName.replace(`mcp_${this.entry.id}_`, '');
    const result = await this.sendRequest('tools/call', {
      name: originalName,
      arguments: args,
    }) as { content: Array<{ type: string; text?: string }> };
    return (result.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n') || '(empty result)';
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;
    try { this.sendNotification('notifications/cancelled', {}); } catch { /* ignore */ }
    this.process.kill('SIGTERM');
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.process?.kill('SIGKILL'); resolve(); }, 5000);
      this.process?.on('exit', () => { clearTimeout(timer); resolve(); });
    });
    this.process = null;
    this.initialized = false;
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) { reject(new Error('MCP process not running')); return; }
      const id = this.nextId++;
      this.pendingRequests.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params } as JsonRpcRequest) + '\n');
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin) return;
    this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcResponse;
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          this.pendingRequests.delete(msg.id);
          if (msg.error) pending.reject(new Error(`MCP error: ${msg.error.message}`));
          else pending.resolve(msg.result);
        }
      } catch { /* non-JSON line */ }
    }
  }
}

// ─── MCP 配置加载 ───

interface McpJsonConfig {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  }>;
}

/** 从 .mcp.json 或 ~/.jowork/mcp.json 加载 MCP 服务器配置 */
function loadMcpConfig(cwd: string): McpServerEntry[] {
  const candidates = [
    join(cwd, '.mcp.json'),
    join(homedir(), '.jowork', 'mcp.json'),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, 'utf-8');
      const config: McpJsonConfig = JSON.parse(raw);
      if (!config.mcpServers) continue;

      return Object.entries(config.mcpServers).map(([name, server]) => ({
        id: name.replace(/[^a-zA-Z0-9_]/g, '_'),
        name,
        command: server.command,
        args: server.args ?? [],
        env: server.env ?? {},
        cwd: server.cwd ? resolve(cwd, server.cwd) : cwd,
      }));
    } catch { continue; }
  }

  return [];
}

// ─── 公共接口 ───

const activeBridges = new Map<string, EdgeMcpBridge>();

/** 加载本地 MCP 配置并启动所有 MCP 服务器 */
export async function initLocalMcp(cwd: string): Promise<{
  toolDefs: AnthropicToolDef[];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>;
}> {
  const entries = loadMcpConfig(cwd);
  const allToolDefs: AnthropicToolDef[] = [];

  for (const entry of entries) {
    try {
      const bridge = new EdgeMcpBridge(entry);
      await bridge.start();
      const tools = await bridge.listTools();
      allToolDefs.push(...tools);
      activeBridges.set(entry.id, bridge);
    } catch {
      // MCP server 启动失败不影响其他功能
    }
  }

  return {
    toolDefs: allToolDefs,
    executeTool: async (name: string, input: Record<string, unknown>): Promise<string> => {
      // 找到对应的 bridge: name 格式 mcp_{id}_{tool_name}
      const match = name.match(/^mcp_([^_]+)_/);
      if (!match) throw new Error(`Invalid MCP tool name: ${name}`);
      const bridge = activeBridges.get(match[1]);
      if (!bridge) throw new Error(`MCP server not found: ${match[1]}`);
      return bridge.callTool(name, input);
    },
  };
}

/** 关闭所有 MCP 服务器 */
export async function shutdownLocalMcp(): Promise<void> {
  for (const bridge of activeBridges.values()) {
    await bridge.shutdown();
  }
  activeBridges.clear();
}

/** 检查 tool name 是否是 MCP 工具 */
export function isMcpTool(name: string): boolean {
  return name.startsWith('mcp_');
}

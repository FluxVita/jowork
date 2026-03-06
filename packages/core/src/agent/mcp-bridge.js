/**
 * MCP 工具桥接 — 管理外部 MCP 服务器子进程 (JSON-RPC over stdio)。
 */
import { spawn } from 'node:child_process';
import { createLogger } from '../utils/logger.js';
import { getDb } from '../datamap/db.js';
import { genId } from '../utils/id.js';
const log = createLogger('mcp-bridge');
// ─── McpBridge ───
export class McpBridge {
    process = null;
    config;
    nextId = 1;
    pendingRequests = new Map();
    buffer = '';
    initialized = false;
    constructor(config) {
        this.config = config;
    }
    /** 启动 MCP 服务器子进程 */
    async start() {
        if (this.process)
            return;
        log.info(`Starting MCP server: ${this.config.name} (${this.config.command})`);
        this.process = spawn(this.config.command, this.config.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...this.config.env },
        });
        this.process.stdout?.on('data', (data) => {
            this.buffer += data.toString();
            this.processBuffer();
        });
        this.process.stderr?.on('data', (data) => {
            log.debug(`MCP stderr [${this.config.name}]: ${data.toString().trim()}`);
        });
        this.process.on('exit', (code) => {
            log.info(`MCP server ${this.config.name} exited with code ${code}`);
            this.process = null;
            this.initialized = false;
            // Reject all pending requests
            for (const [, pending] of this.pendingRequests) {
                pending.reject(new Error(`MCP server exited with code ${code}`));
            }
            this.pendingRequests.clear();
        });
        // Send initialize
        await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'jowork-agent', version: '1.0.0' },
        });
        // Send initialized notification
        this.sendNotification('notifications/initialized', {});
        this.initialized = true;
        log.info(`MCP server ${this.config.name} initialized`);
    }
    /** 列出可用工具 */
    async listTools() {
        if (!this.initialized)
            await this.start();
        const result = await this.sendRequest('tools/list', {});
        const tools = result.tools ?? [];
        return tools.map(t => ({
            name: `mcp_${this.config.id}_${t.name}`,
            description: `[MCP:${this.config.name}] ${t.description ?? t.name}`,
            input_schema: t.inputSchema ?? { type: 'object', properties: {} },
        }));
    }
    /** 调用 MCP 工具 */
    async callTool(toolName, args) {
        if (!this.initialized)
            await this.start();
        // 去掉 mcp_{id}_ 前缀还原原始名
        const originalName = toolName.replace(`mcp_${this.config.id}_`, '');
        const result = await this.sendRequest('tools/call', {
            name: originalName,
            arguments: args,
        });
        const textParts = (result.content ?? [])
            .filter(c => c.type === 'text')
            .map(c => c.text ?? '');
        return textParts.join('\n') || '(empty result)';
    }
    /** 优雅关闭子进程 */
    async shutdown() {
        if (!this.process)
            return;
        log.info(`Shutting down MCP server: ${this.config.name}`);
        try {
            this.sendNotification('notifications/cancelled', {});
        }
        catch { /* ignore */ }
        this.process.kill('SIGTERM');
        // 等待最多 5 秒
        await new Promise(resolve => {
            const timer = setTimeout(() => {
                this.process?.kill('SIGKILL');
                resolve();
            }, 5000);
            this.process?.on('exit', () => {
                clearTimeout(timer);
                resolve();
            });
        });
        this.process = null;
        this.initialized = false;
    }
    // ─── JSON-RPC 通信 ───
    sendRequest(method, params) {
        return new Promise((resolve, reject) => {
            if (!this.process?.stdin) {
                reject(new Error('MCP process not running'));
                return;
            }
            const id = this.nextId++;
            const request = { jsonrpc: '2.0', id, method, params };
            this.pendingRequests.set(id, { resolve, reject });
            const msg = JSON.stringify(request) + '\n';
            this.process.stdin.write(msg);
            // 超时 30 秒
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`MCP request timeout: ${method}`));
                }
            }, 30_000);
        });
    }
    sendNotification(method, params) {
        if (!this.process?.stdin)
            return;
        const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
        this.process.stdin.write(msg);
    }
    processBuffer() {
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                const msg = JSON.parse(line);
                if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
                    const pending = this.pendingRequests.get(msg.id);
                    this.pendingRequests.delete(msg.id);
                    if (msg.error) {
                        pending.reject(new Error(`MCP error: ${msg.error.message}`));
                    }
                    else {
                        pending.resolve(msg.result);
                    }
                }
            }
            catch {
                log.debug(`Non-JSON line from MCP: ${line.slice(0, 100)}`);
            }
        }
    }
}
// ─── MCP Server CRUD (SQLite) ───
export function ensureMcpTable() {
    const db = getDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      args_json TEXT DEFAULT '[]',
      env_json TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}
export function listMcpServers() {
    ensureMcpTable();
    const db = getDb();
    const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at').all();
    return rows.map(rowToConfig);
}
export function getActiveMcpServers() {
    ensureMcpTable();
    const db = getDb();
    const rows = db.prepare('SELECT * FROM mcp_servers WHERE is_active = 1').all();
    return rows.map(rowToConfig);
}
export function addMcpServer(opts) {
    ensureMcpTable();
    const db = getDb();
    const id = genId('mcp');
    db.prepare(`
    INSERT INTO mcp_servers (id, name, command, args_json, env_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, opts.name, opts.command, JSON.stringify(opts.args ?? []), JSON.stringify(opts.env ?? {}));
    return { id, name: opts.name, command: opts.command, args: opts.args ?? [], env: opts.env ?? {}, is_active: true };
}
export function removeMcpServer(id) {
    ensureMcpTable();
    const db = getDb();
    const result = db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    return result.changes > 0;
}
function rowToConfig(row) {
    return {
        id: row['id'],
        name: row['name'],
        command: row['command'],
        args: JSON.parse(row['args_json'] || '[]'),
        env: JSON.parse(row['env_json'] || '{}'),
        is_active: row['is_active'] === 1,
    };
}
const activeBridges = new Map();
/** 获取或创建 MCP Bridge 实例 */
export async function getOrCreateBridge(config) {
    const entry = activeBridges.get(config.id);
    if (entry) {
        entry.lastUsedAt = Date.now();
        return entry.bridge;
    }
    const bridge = new McpBridge(config);
    await bridge.start();
    activeBridges.set(config.id, { bridge, lastUsedAt: Date.now() });
    return bridge;
}
// 每 5 分钟清理超过 30 分钟未使用的 MCP bridge（防止子进程泄露）
setInterval(() => {
    const now = Date.now();
    const IDLE_MS = 30 * 60_000;
    for (const [id, entry] of activeBridges) {
        if (now - entry.lastUsedAt > IDLE_MS) {
            try {
                entry.bridge.shutdown();
            }
            catch { /* ignore */ }
            activeBridges.delete(id);
            log.info(`MCP bridge ${id} closed (idle >30min)`);
        }
    }
}, 5 * 60_000);
/** 获取所有活跃 MCP 服务器的工具定义 */
export async function getAllMcpToolDefs() {
    const servers = getActiveMcpServers();
    const allDefs = [];
    for (const server of servers) {
        try {
            const bridge = await getOrCreateBridge(server);
            const tools = await bridge.listTools();
            allDefs.push(...tools);
        }
        catch (err) {
            log.error(`Failed to get tools from MCP server ${server.name}`, String(err));
        }
    }
    return allDefs;
}
/** 通过 MCP Bridge 执行工具 */
export async function executeMcpTool(toolName, input) {
    // 从工具名解析出 server id: mcp_{serverId}_{toolName}
    const parts = toolName.match(/^mcp_([^_]+)_(.+)$/);
    if (!parts)
        throw new Error(`Invalid MCP tool name: ${toolName}`);
    const serverId = parts[1];
    const entry = activeBridges.get(serverId);
    if (!entry)
        throw new Error(`MCP server not active: ${serverId}`);
    entry.lastUsedAt = Date.now();
    return entry.bridge.callTool(toolName, input);
}
/** 启用/禁用 MCP 服务器 */
export function setMcpServerActive(id, active) {
    ensureMcpTable();
    const db = getDb();
    const result = db.prepare('UPDATE mcp_servers SET is_active = ? WHERE id = ?')
        .run(active ? 1 : 0, id);
    // 禁用时关闭 bridge
    if (!active && activeBridges.has(id)) {
        activeBridges.get(id).bridge.shutdown();
        activeBridges.delete(id);
    }
    return result.changes > 0;
}
/** 更新 MCP 服务器配置 */
export function updateMcpServer(id, opts) {
    ensureMcpTable();
    const db = getDb();
    const sets = [];
    const vals = [];
    if (opts.name) {
        sets.push('name = ?');
        vals.push(opts.name);
    }
    if (opts.command) {
        sets.push('command = ?');
        vals.push(opts.command);
    }
    if (opts.args) {
        sets.push('args_json = ?');
        vals.push(JSON.stringify(opts.args));
    }
    if (opts.env) {
        sets.push('env_json = ?');
        vals.push(JSON.stringify(opts.env));
    }
    if (sets.length === 0)
        return false;
    vals.push(id);
    const result = db.prepare(`UPDATE mcp_servers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    // 配置变了，重启 bridge
    if (result.changes > 0 && activeBridges.has(id)) {
        activeBridges.get(id).bridge.shutdown();
        activeBridges.delete(id);
    }
    return result.changes > 0;
}
/** 获取 MCP 服务器运行状态 */
export function getMcpServerStatus(id) {
    const bridge = activeBridges.get(id);
    return {
        running: !!bridge,
        tool_count: 0, // listTools 是 async，这里只做同步快照
    };
}
/** 关闭所有 MCP Bridge */
export async function shutdownAllBridges() {
    for (const [id, entry] of activeBridges) {
        await entry.bridge.shutdown();
        activeBridges.delete(id);
    }
}
//# sourceMappingURL=mcp-bridge.js.map
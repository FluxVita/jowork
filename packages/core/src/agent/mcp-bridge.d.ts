/**
 * MCP 工具桥接 — 管理外部 MCP 服务器子进程 (JSON-RPC over stdio)。
 */
import type { AnthropicToolDef } from './types.js';
export interface McpServerConfig {
    id: string;
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    is_active: boolean;
}
export declare class McpBridge {
    private process;
    private config;
    private nextId;
    private pendingRequests;
    private buffer;
    private initialized;
    constructor(config: McpServerConfig);
    /** 启动 MCP 服务器子进程 */
    start(): Promise<void>;
    /** 列出可用工具 */
    listTools(): Promise<AnthropicToolDef[]>;
    /** 调用 MCP 工具 */
    callTool(toolName: string, args: Record<string, unknown>): Promise<string>;
    /** 优雅关闭子进程 */
    shutdown(): Promise<void>;
    private sendRequest;
    private sendNotification;
    private processBuffer;
}
export declare function ensureMcpTable(): void;
export declare function listMcpServers(): McpServerConfig[];
export declare function getActiveMcpServers(): McpServerConfig[];
export declare function addMcpServer(opts: {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
}): McpServerConfig;
export declare function removeMcpServer(id: string): boolean;
/** 获取或创建 MCP Bridge 实例 */
export declare function getOrCreateBridge(config: McpServerConfig): Promise<McpBridge>;
/** 获取所有活跃 MCP 服务器的工具定义 */
export declare function getAllMcpToolDefs(): Promise<AnthropicToolDef[]>;
/** 通过 MCP Bridge 执行工具 */
export declare function executeMcpTool(toolName: string, input: Record<string, unknown>): Promise<string>;
/** 启用/禁用 MCP 服务器 */
export declare function setMcpServerActive(id: string, active: boolean): boolean;
/** 更新 MCP 服务器配置 */
export declare function updateMcpServer(id: string, opts: {
    name?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
}): boolean;
/** 获取 MCP 服务器运行状态 */
export declare function getMcpServerStatus(id: string): {
    running: boolean;
    tool_count: number;
};
/** 关闭所有 MCP Bridge */
export declare function shutdownAllBridges(): Promise<void>;
//# sourceMappingURL=mcp-bridge.d.ts.map
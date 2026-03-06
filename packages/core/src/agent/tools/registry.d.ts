import type { Tool, AnthropicToolDef } from '../types.js';
/** 获取内置工具（用于 controller 执行） */
export declare function getBuiltinTool(name: string): Tool | undefined;
/** 获取工具（内置优先，向后兼容） */
export declare function getTool(name: string): Tool | undefined;
export declare function getAllTools(): Tool[];
/** 获取所有工具定义（内置 + 外部） */
export declare function getToolDefinitions(): AnthropicToolDef[];
/** 注册外部工具定义（来自 MCP / Skills） */
export declare function registerExternalToolDefs(defs: AnthropicToolDef[]): void;
/** 清除外部工具定义 */
export declare function clearExternalToolDefs(): void;
export declare function initTools(): void;
//# sourceMappingURL=registry.d.ts.map
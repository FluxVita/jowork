import type { AnthropicToolDef } from '../agent/types.js';
/** Skill 清单文件定义 */
export interface SkillManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    /** 内置工具定义 */
    tools?: SkillToolDef[];
    /** MCP 服务器配置 */
    mcp_servers?: SkillMcpConfig[];
    /** 额外的 system prompt 注入 */
    system_prompt?: string;
    /** 触发关键词（用于自动激活） */
    triggers?: string[];
}
export interface SkillToolDef {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
    /** 工具的 handler 脚本（相对于 skill 目录） */
    handler: string;
}
export interface SkillMcpConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
}
/** 数据库中的 Skill 记录 */
export interface SkillRecord {
    id: string;
    name: string;
    version: string;
    manifest_json: string;
    is_active: boolean;
    installed_at: string;
    /** 运行时解析出的 manifest */
    manifest?: SkillManifest;
}
/** Skill 提供给 Agent 的工具定义 */
export type SkillAnthropicToolDef = AnthropicToolDef;
//# sourceMappingURL=types.d.ts.map
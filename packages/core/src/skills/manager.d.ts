/**
 * Skill 生命周期管理 — 安装/卸载/启用/禁用 + MCP 服务自动启动。
 */
import type { SkillManifest, SkillRecord } from './types.js';
import type { AnthropicToolDef } from '../agent/types.js';
export declare function ensureSkillsTable(): void;
export declare function listSkills(): SkillRecord[];
export declare function getActiveSkills(): SkillRecord[];
export declare function getSkill(id: string): SkillRecord | null;
export declare function installSkill(manifest: SkillManifest): SkillRecord;
export declare function uninstallSkill(id: string): boolean;
export declare function setSkillActive(id: string, active: boolean): boolean;
/** 获取所有活跃 Skill 的工具定义 */
export declare function getAllSkillToolDefs(): AnthropicToolDef[];
/** 获取所有活跃 Skill 的 system prompt 片段 */
export declare function getAllSkillPrompts(): string[];
/** 启动 Skill 声明的 MCP 服务器 */
export declare function startSkillMcpServers(manifest: SkillManifest): Promise<void>;
//# sourceMappingURL=manager.d.ts.map
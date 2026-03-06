/**
 * Skill 加载器 — 从目录或数据库加载 Skill 清单。
 */
import type { SkillManifest, SkillRecord } from './types.js';
import type { AnthropicToolDef } from '../agent/types.js';
/** 从目录加载单个 Skill manifest */
export declare function loadSkillFromDir(dir: string): SkillManifest | null;
/** 扫描 data/skills/ 目录加载所有 Skill */
export declare function loadAllSkillsFromDisk(baseDir: string): SkillManifest[];
/** 从 SkillRecord 解析出 manifest */
export declare function parseSkillRecord(record: SkillRecord): SkillRecord;
/** 获取 Skill 提供的工具定义（加 skill 前缀） */
export declare function getSkillToolDefs(manifest: SkillManifest): AnthropicToolDef[];
/** 获取 Skill 的 system prompt 片段 */
export declare function getSkillPrompt(manifest: SkillManifest): string | null;
/** 检查消息是否匹配 Skill 触发词 */
export declare function matchesTrigger(manifest: SkillManifest, message: string): boolean;
//# sourceMappingURL=loader.d.ts.map
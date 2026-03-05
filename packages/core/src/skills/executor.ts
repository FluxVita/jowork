/**
 * skills/executor.ts — Free tier stub
 * Premium 注入真实实现
 */
import type { Tool } from '../agent/types.js';

type ExecuteSkillFn = (name: string, input: Record<string, unknown>) => Promise<string>;

let _executeSkillTool: ExecuteSkillFn = async (name) =>
  `技能 "${name}" 不可用（需要 Premium）`;

export function registerSkillExecutor(fn: ExecuteSkillFn) {
  _executeSkillTool = fn;
}

export const executeSkillTool: ExecuteSkillFn = (name, input) =>
  _executeSkillTool(name, input);

/** 获取技能工具定义（Premium 注入） */
let _getSkillToolDefs: () => Tool[] = () => [];
export function registerSkillToolDefsProvider(fn: () => Tool[]) {
  _getSkillToolDefs = fn;
}
export const getSkillToolDefs = () => _getSkillToolDefs();

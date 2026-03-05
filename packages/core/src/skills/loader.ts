/**
 * Skill 加载器 — 从目录或数据库加载 Skill 清单。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger } from '../utils/logger.js';
import type { SkillManifest, SkillRecord } from './types.js';
import type { AnthropicToolDef } from '../agent/types.js';

const log = createLogger('skill-loader');

/** 从目录加载单个 Skill manifest */
export function loadSkillFromDir(dir: string): SkillManifest | null {
  const manifestPath = resolve(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    log.warn(`No manifest.json in ${dir}`);
    return null;
  }

  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as SkillManifest;

    if (!manifest.id || !manifest.name || !manifest.version) {
      log.warn(`Invalid manifest in ${dir}: missing id/name/version`);
      return null;
    }

    return manifest;
  } catch (err) {
    log.error(`Failed to load manifest from ${dir}`, String(err));
    return null;
  }
}

/** 扫描 data/skills/ 目录加载所有 Skill */
export function loadAllSkillsFromDisk(baseDir: string): SkillManifest[] {
  if (!existsSync(baseDir)) return [];

  const manifests: SkillManifest[] = [];
  const entries = readdirSync(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifest = loadSkillFromDir(resolve(baseDir, entry.name));
    if (manifest) {
      manifests.push(manifest);
      log.info(`Loaded skill: ${manifest.name} v${manifest.version}`);
    }
  }

  return manifests;
}

/** 从 SkillRecord 解析出 manifest */
export function parseSkillRecord(record: SkillRecord): SkillRecord {
  try {
    record.manifest = JSON.parse(record.manifest_json) as SkillManifest;
  } catch {
    log.warn(`Failed to parse manifest for skill ${record.id}`);
  }
  return record;
}

/** 获取 Skill 提供的工具定义（加 skill 前缀） */
export function getSkillToolDefs(manifest: SkillManifest): AnthropicToolDef[] {
  if (!manifest.tools || manifest.tools.length === 0) return [];

  return manifest.tools.map(t => ({
    name: `skill_${manifest.id}_${t.name}`,
    description: `[Skill:${manifest.name}] ${t.description}`,
    input_schema: t.input_schema,
  }));
}

/** 获取 Skill 的 system prompt 片段 */
export function getSkillPrompt(manifest: SkillManifest): string | null {
  return manifest.system_prompt ?? null;
}

/** 检查消息是否匹配 Skill 触发词 */
export function matchesTrigger(manifest: SkillManifest, message: string): boolean {
  if (!manifest.triggers || manifest.triggers.length === 0) return false;
  const lower = message.toLowerCase();
  return manifest.triggers.some(t => lower.includes(t.toLowerCase()));
}

// @jowork/premium/skills/executor — advanced skill execution (unlimited skills)

import type { ToolDefinition, ToolContext } from '@jowork/core';
import { logger } from '@jowork/core';

/** Skill manifest as loaded from a skill directory */
export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  entrypoint: string;
}

const loadedSkills = new Map<string, ToolDefinition>();

/** Dynamically load a skill from a directory */
export async function loadSkill(skillDir: string): Promise<ToolDefinition> {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  const manifest = JSON.parse(
    readFileSync(join(skillDir, 'skill.json'), 'utf8'),
  ) as SkillManifest;

  const entrypath = join(skillDir, manifest.entrypoint);
  const mod = await import(entrypath) as { execute: ToolDefinition['execute']; inputSchema?: ToolDefinition['inputSchema'] };

  const skill: ToolDefinition = {
    name: manifest.name,
    description: manifest.description,
    inputSchema: mod.inputSchema ?? { type: 'object', properties: {} },
    execute: mod.execute,
  };

  loadedSkills.set(skill.name, skill);
  logger.info('Skill loaded', { name: skill.name, version: manifest.version });
  return skill;
}

export async function executeSkill(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const skill = loadedSkills.get(name);
  if (!skill) throw new Error(`Skill '${name}' is not loaded`);
  return skill.execute(input, ctx);
}

export function listLoadedSkills(): string[] {
  return Array.from(loadedSkills.keys());
}

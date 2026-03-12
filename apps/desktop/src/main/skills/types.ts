export type SkillSource = 'claude-code' | 'openclaw' | 'jowork' | 'community';
export type SkillType = 'simple' | 'workflow';

export interface SkillVariable {
  name: string;
  label: string;
  type: 'text' | 'select' | 'multiline';
  required?: boolean;
  default?: string;
  options?: string[];
}

export interface SkillStep {
  id: string;
  prompt: string;
  condition?: string;
  outputVar?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  trigger: string;
  type: SkillType;
  promptTemplate?: string;
  steps?: SkillStep[];
  variables?: SkillVariable[];
  filePath?: string;
}

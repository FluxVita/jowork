export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  tools?: string[];
}

export interface Skill {
  id: string;
  manifest: SkillManifest;
  enabled: boolean;
  installedAt: Date;
}

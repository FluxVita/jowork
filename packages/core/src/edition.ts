// Edition feature gating — Free vs Premium
// See JOWORK-PLAN.md Section 5.3 for full interface spec

export interface EditionFeatures {
  maxDataSources: number;
  maxUsers: number;
  maxContextTokens: number;
  agentEngines: string[];
  hasVectorMemory: boolean;
  hasGeekMode: boolean;
  hasSubAgent: boolean;
  hasEventTrigger: boolean;
  hasGoalDriven: boolean;
  hasAdvancedRBAC: boolean;
  hasAuditLog: boolean;
}

export const FREE_EDITION: EditionFeatures = {
  maxDataSources: 5,
  maxUsers: 5,
  maxContextTokens: 32_000,
  agentEngines: ['builtin'],
  hasVectorMemory: false,
  hasGeekMode: false,
  hasSubAgent: false,
  hasEventTrigger: false,
  hasGoalDriven: false,
  hasAdvancedRBAC: false,
  hasAuditLog: false,
};

let currentEdition: EditionFeatures = { ...FREE_EDITION };

export function registerEdition(features: Partial<EditionFeatures>): void {
  currentEdition = { ...currentEdition, ...features };
}

export function getEdition(): EditionFeatures {
  return currentEdition;
}

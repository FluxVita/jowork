// Premium edition activation
// Phase 0 skeleton — license validation to be implemented in Phase 2

import { registerEdition } from '@jowork/core';

export function activatePremium(_licenseKey: string): void {
  // TODO Phase 2: validate license key via LemonSqueezy
  registerEdition({
    maxDataSources: Infinity,
    maxUsers: Infinity,
    maxContextTokens: 100_000,
    agentEngines: ['builtin', 'claude-agent'],
    hasVectorMemory: true,
    hasGeekMode: true,
    hasSubAgent: true,
    hasEventTrigger: true,
    hasGoalDriven: true,
    hasAdvancedRBAC: true,
    hasAuditLog: true,
  });
}

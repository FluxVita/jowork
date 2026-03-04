// @jowork/premium — premium edition activation
// Call activatePremium() during app startup to unlock premium features.

import { registerEdition } from '@jowork/core';
import { logger } from '@jowork/core';

export function activatePremium(licenseKey?: string): void {
  // TODO: validate licenseKey via LemonSqueezy API (Phase 5+)
  if (licenseKey) {
    logger.info('Activating premium edition', { keyPrefix: licenseKey.slice(0, 8) });
  } else {
    logger.warn('Activating premium edition without license key (dev mode)');
  }

  registerEdition({
    maxDataSources: Infinity,
    maxUsers: 200,
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

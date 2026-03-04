// @jowork/premium — premium edition activation
//
// Usage:
//   await activatePremium({ token: process.env.JOWORK_SUBSCRIPTION_TOKEN, dataDir })
//
// When a valid subscription token is provided the subscription verifier is
// initialised (daily remote check + 7-day local grace period cache).
// Without a token the edition is activated in dev_mode (all features unlocked,
// no remote check performed — suitable for self-hosted open-source use).

import { registerEdition } from '@jowork/core';
import { logger } from '@jowork/core';
import { initSubscription, getSubscriptionState } from './subscription/index.js';

export interface ActivatePremiumOptions {
  /** Subscription token from jowork.work (omit for dev/self-hosted mode) */
  token?: string;
  /** Data directory for the subscription cache file */
  dataDir?: string;
}

export async function activatePremium(opts: ActivatePremiumOptions = {}): Promise<void> {
  const { token = '', dataDir = '.' } = opts;

  await initSubscription(token, dataDir);

  const state = getSubscriptionState();

  if (state.status === 'expired') {
    logger.warn('Premium subscription has expired — falling back to Free edition', {
      plan: state.plan,
      expiresAt: state.expiresAt,
    });
    // Do not call registerEdition — keep Free limits
    return;
  }

  if (state.status === 'grace_period') {
    logger.warn('Premium subscription is in grace period (renewal overdue by <7 days)', {
      lastFetchedAt: state.lastFetchedAt,
    });
  } else if (state.status === 'dev_mode') {
    logger.warn('Activating premium in dev_mode (no subscription token — self-hosted)');
  } else {
    logger.info('Premium subscription active', { plan: state.plan, expiresAt: state.expiresAt });
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

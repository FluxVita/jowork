// @jowork/premium/alerts/engine — event-triggered + goal-driven alerts

import type { SchedulerTask } from '@jowork/core';
import { broadcast, logger } from '@jowork/core';

export type AlertTrigger = 'event' | 'goal';

export interface AlertRule {
  id: string;
  name: string;
  trigger: AlertTrigger;
  /** For event triggers: the event type to watch (e.g., 'connector.new_item') */
  eventType?: string;
  /** For goal triggers: natural language goal description */
  goal?: string;
  agentId: string;
  userId: string;
  enabled: boolean;
}

/** In-memory alert rules (Phase 2: backed by DB later) */
const alertRules = new Map<string, AlertRule>();

export function registerAlertRule(rule: AlertRule): void {
  alertRules.set(rule.id, rule);
  logger.info('Alert rule registered', { id: rule.id, trigger: rule.trigger });
}

export function removeAlertRule(id: string): void {
  alertRules.delete(id);
}

/** Emit an event and trigger matching alert rules */
export async function emitEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  for (const rule of alertRules.values()) {
    if (!rule.enabled) continue;
    if (rule.trigger !== 'event' || rule.eventType !== eventType) continue;

    await broadcast({
      title: `Alert: ${rule.name}`,
      body: `Event '${eventType}' triggered: ${JSON.stringify(payload).slice(0, 200)}`,
      agentId: rule.agentId,
      userId: rule.userId,
    }).catch(err => logger.error('Alert broadcast failed', { err: String(err) }));
  }
}

/** Called by scheduler to evaluate goal-driven alerts */
export async function evaluateGoals(_task: SchedulerTask): Promise<void> {
  // Goal-driven evaluation requires premium LLM call to judge if goal was met
  // Placeholder: will be wired up with Claude Agent SDK in a future iteration
  logger.debug('Goal evaluation placeholder', { taskId: _task.id });
}

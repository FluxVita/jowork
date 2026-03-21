import Database from 'better-sqlite3';
import { logInfo } from '../utils/logger.js';

export interface TriggerResult {
  goalsChecked: number;
  triggersFired: number;
  notifications: Array<{ goalId: string; goalTitle: string; message: string }>;
}

/**
 * Check all active goals for trigger conditions.
 * Called after signal polling completes.
 */
export function evaluateTriggers(sqlite: Database.Database): TriggerResult {
  const result: TriggerResult = { goalsChecked: 0, triggersFired: 0, notifications: [] };

  // Get all active goals
  const goals = sqlite.prepare(`
    SELECT g.id, g.title, g.autonomy_level FROM goals g WHERE g.status = 'active'
  `).all() as Array<{ id: string; title: string; autonomy_level: string }>;

  for (const goal of goals) {
    result.goalsChecked++;

    const measures = sqlite.prepare(`
      SELECT m.*, s.title as signal_title, s.direction, s.current_value as signal_value
      FROM measures m
      JOIN signals s ON s.id = m.signal_id
      WHERE s.goal_id = ?
    `).all(goal.id) as Array<{
      id: string; signal_id: string; threshold: number; comparison: string;
      current: number | null; met: number; signal_title: string;
      direction: string; signal_value: number | null;
    }>;

    for (const measure of measures) {
      if (measure.signal_value === null) continue;

      const wasMet = measure.met === 1;
      const isMet = evaluate(measure.comparison, measure.signal_value, measure.threshold);

      // Detect state change
      if (isMet && !wasMet) {
        // Measure just became met
        const msg = `Goal "${goal.title}": ${measure.signal_title} reached ${measure.signal_value} (target: ${measure.comparison} ${measure.threshold})`;
        result.notifications.push({ goalId: goal.id, goalTitle: goal.title, message: msg });
        result.triggersFired++;
        logInfo('trigger', msg);
      } else if (!isMet && wasMet) {
        // Measure was met but now regressed
        const msg = `Goal "${goal.title}": ${measure.signal_title} dropped to ${measure.signal_value} (was meeting target, now below ${measure.comparison} ${measure.threshold})`;
        result.notifications.push({ goalId: goal.id, goalTitle: goal.title, message: msg });
        result.triggersFired++;
        logInfo('trigger', msg);
      }
    }
  }

  if (result.triggersFired > 0) {
    logInfo('trigger', `Evaluated ${result.goalsChecked} goals, fired ${result.triggersFired} triggers`);
  }

  return result;
}

function evaluate(comparison: string, value: number, threshold: number): boolean {
  switch (comparison) {
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}

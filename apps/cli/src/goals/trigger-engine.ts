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
  const now = Date.now();

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

      // Detect signal moving in wrong direction for maximize/minimize goals
      if (measure.current !== null && measure.signal_value !== null) {
        const delta = measure.signal_value - measure.current;
        const isRegressing =
          (measure.direction === 'maximize' && delta < 0) ||
          (measure.direction === 'minimize' && delta > 0);
        if (isRegressing) {
          const direction = delta > 0 ? 'increased' : 'decreased';
          const msg = `Goal "${goal.title}": ${measure.signal_title} ${direction} to ${measure.signal_value} (was ${measure.current}, should ${measure.direction})`;
          result.notifications.push({ goalId: goal.id, goalTitle: goal.title, message: msg });
          result.triggersFired++;
          logInfo('trigger', msg);
        }
      }
    }
  }

  // Check for stale signals (not polled in 2x poll_interval)
  const staleSignals = sqlite.prepare(`
    SELECT s.title, s.poll_interval, s.last_polled_at, g.title as goal_title, g.id as goal_id
    FROM signals s JOIN goals g ON g.id = s.goal_id
    WHERE g.status = 'active'
    AND s.last_polled_at IS NOT NULL
    AND s.last_polled_at + (s.poll_interval * 2000) < ?
  `).all(now) as Array<{ title: string; poll_interval: number; last_polled_at: number; goal_title: string; goal_id: string }>;

  for (const stale of staleSignals) {
    const agoMin = Math.round((now - stale.last_polled_at) / 60000);
    const msg = `Signal "${stale.title}" is stale (last polled ${agoMin} min ago, interval is ${stale.poll_interval}s)`;
    result.notifications.push({ goalId: stale.goal_id, goalTitle: stale.goal_title, message: msg });
    result.triggersFired++;
    logInfo('trigger', msg);
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

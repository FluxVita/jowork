import Database from 'better-sqlite3';

export interface NotificationRule {
  id: string;
  connectorId: string;
  condition: string;        // 'mention_me' | 'p0_issue' | 'pr_review_requested' | 'custom'
  customFilter?: string;
  channels: string[];       // ['system', 'feishu', 'app']
  silentHours?: { start: string; end: string };
  aiSummary: boolean;
}

/**
 * Manages notification rules stored in settings as JSON.
 * Lightweight: no separate table, uses the settings key-value store.
 */
export class NotificationRuleManager {
  private sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.sqlite = sqlite;
  }

  getRules(): NotificationRule[] {
    const row = this.sqlite
      .prepare("SELECT value FROM settings WHERE key = 'notification_rules'")
      .get() as { value: string } | undefined;

    if (!row) return [];
    try {
      return JSON.parse(row.value);
    } catch {
      return [];
    }
  }

  saveRules(rules: NotificationRule[]): void {
    const now = Date.now();
    this.sqlite
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('notification_rules', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(rules), now);
  }

  addRule(rule: NotificationRule): void {
    const rules = this.getRules();
    rules.push(rule);
    this.saveRules(rules);
  }

  updateRule(id: string, patch: Partial<NotificationRule>): void {
    const rules = this.getRules().map((r) =>
      r.id === id ? { ...r, ...patch } : r,
    );
    this.saveRules(rules);
  }

  deleteRule(id: string): void {
    const rules = this.getRules().filter((r) => r.id !== id);
    this.saveRules(rules);
  }

  /** Check if current time is within the rule's silent hours */
  isInSilentHours(rule: NotificationRule): boolean {
    if (!rule.silentHours) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = rule.silentHours.start.split(':').map(Number);
    const [endH, endM] = rule.silentHours.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    // Wraps midnight
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

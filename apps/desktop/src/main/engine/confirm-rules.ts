import type Database from 'better-sqlite3';

export interface ConfirmRule {
  toolPattern: string;
  action: 'auto' | 'confirm' | 'block';
  userOverridable: boolean;
}

/** Default rules: conservative for write operations, auto for reads. */
const DEFAULT_RULES: ConfirmRule[] = [
  // Auto-approve read operations
  { toolPattern: '*/list_*', action: 'auto', userOverridable: true },
  { toolPattern: '*/get_*', action: 'auto', userOverridable: true },
  { toolPattern: '*/search_*', action: 'auto', userOverridable: true },
  { toolPattern: '*/read_*', action: 'auto', userOverridable: true },

  // Require confirmation for write operations
  { toolPattern: '*/create_*', action: 'confirm', userOverridable: true },
  { toolPattern: '*/update_*', action: 'confirm', userOverridable: true },
  { toolPattern: '*/delete_*', action: 'confirm', userOverridable: true },
  { toolPattern: 'github/create_pull_request', action: 'confirm', userOverridable: true },
  { toolPattern: 'github/create_issue', action: 'confirm', userOverridable: true },
  { toolPattern: '*/send_*', action: 'confirm', userOverridable: true },
  { toolPattern: 'feishu/*', action: 'confirm', userOverridable: true },

  // Block dangerous operations
  { toolPattern: '*/force_*', action: 'block', userOverridable: false },
];

/**
 * ConfirmRuleEngine evaluates tool calls against a set of rules
 * to decide whether they should auto-execute, require user confirmation,
 * or be blocked entirely.
 */
export class ConfirmRuleEngine {
  private rules: ConfirmRule[];
  private allowedTools = new Set<string>();

  constructor(private sqlite?: Database.Database) {
    this.rules = [...DEFAULT_RULES];
    this.loadUserOverrides();
  }

  private loadUserOverrides(): void {
    if (!this.sqlite) return;
    try {
      const row = this.sqlite
        .prepare("SELECT value FROM settings WHERE key = 'confirm_allowed_tools'")
        .get() as { value: string } | undefined;
      if (row?.value) {
        const tools = JSON.parse(row.value) as string[];
        for (const t of tools) this.allowedTools.add(t);
      }
    } catch {
      // Fresh start
    }
  }

  private saveUserOverrides(): void {
    if (!this.sqlite) return;
    try {
      this.sqlite.prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
      ).run('confirm_allowed_tools', JSON.stringify([...this.allowedTools]), Date.now());
    } catch {
      // Non-critical
    }
  }

  /**
   * Evaluate a tool call and return the action to take.
   */
  evaluate(toolName: string): 'auto' | 'confirm' | 'block' {
    // User has permanently allowed this tool
    if (this.allowedTools.has(toolName)) return 'auto';

    // Check rules in order (first match wins)
    for (const rule of this.rules) {
      if (this.matchPattern(rule.toolPattern, toolName)) {
        return rule.action;
      }
    }

    // Default: auto for unmatched tools
    return 'auto';
  }

  /**
   * Mark a tool as permanently allowed (user clicked "Always allow").
   */
  alwaysAllow(toolName: string): void {
    this.allowedTools.add(toolName);
    this.saveUserOverrides();
  }

  /**
   * Get the risk level for a tool based on its action.
   */
  getRisk(toolName: string): 'low' | 'medium' | 'high' {
    const action = this.evaluate(toolName);
    switch (action) {
      case 'auto': return 'low';
      case 'confirm': return 'medium';
      case 'block': return 'high';
    }
  }

  /**
   * Get all rules (for settings UI).
   */
  getRules(): ConfirmRule[] {
    return [...this.rules];
  }

  /**
   * Get all permanently allowed tools.
   */
  getAllowedTools(): string[] {
    return [...this.allowedTools];
  }

  /**
   * Simple glob matching: `*` matches any sequence, `/` is literal.
   */
  private matchPattern(pattern: string, toolName: string): boolean {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\//g, '\\/') + '$',
    );
    return regex.test(toolName);
  }
}

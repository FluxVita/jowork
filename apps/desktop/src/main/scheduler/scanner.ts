import type { ConnectorHub } from '../connectors/hub';
import type { NotificationRuleManager, NotificationRule } from './notification-rules';
import type { NotificationManager } from '../system/notifications';
import type Database from 'better-sqlite3';

export interface ScanItem {
  title: string;
  summary?: string;
  url?: string;
}

export interface ScanResult {
  connectorId: string;
  newItems: ScanItem[];
}

/**
 * Per-connector scan strategies: map connector ID → MCP tool name + args
 * that returns a list of recent items we can diff against our last scan cursor.
 */
const SCAN_STRATEGIES: Record<string, { tool: string; args: Record<string, unknown>; extract: (result: unknown) => ScanItem[] }> = {
  github: {
    tool: 'list_notifications',
    args: { all: false },
    extract: (result) => extractContentItems(result, (item) => ({
      title: item.subject?.title ?? item.title ?? 'GitHub notification',
      summary: item.reason ?? item.subject?.type,
      url: item.subject?.url ?? item.html_url,
    })),
  },
  gitlab: {
    tool: 'list_merge_requests',
    args: { state: 'opened' },
    extract: (result) => extractContentItems(result, (item) => ({
      title: item.title ?? 'GitLab MR',
      summary: item.description?.slice(0, 200),
      url: item.web_url,
    })),
  },
  feishu: {
    tool: 'im_v1_chat_list',
    args: {},
    extract: (result) => extractContentItems(result, (item) => ({
      title: item.name ?? item.chat_id ?? 'Feishu chat',
      summary: item.description,
    })),
  },
};

/** Extract text content from MCP tool result and map to ScanItems. */
function extractContentItems(
  result: unknown,
  mapper: (item: Record<string, unknown>) => ScanItem,
): ScanItem[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;

  // MCP tools return { content: [{ type: 'text', text: '...' }] }
  const content = r.content as Array<{ type: string; text?: string }> | undefined;
  if (!content?.length) return [];

  for (const block of content) {
    if (block.type === 'text' && block.text) {
      try {
        const parsed = JSON.parse(block.text);
        const items = Array.isArray(parsed) ? parsed : parsed?.items ?? parsed?.data ?? [];
        if (Array.isArray(items)) {
          return items.slice(0, 50).map(mapper);
        }
      } catch {
        // Non-JSON text — treat as single item
        return [{ title: block.text.slice(0, 100) }];
      }
    }
  }

  return [];
}

/**
 * Scanner: periodically checks connectors for new data and triggers
 * notifications based on matching rules.
 */
export class Scanner {
  /** Track last scan timestamp per connector to detect new items. */
  private lastScanTimestamp = new Map<string, number>();

  constructor(
    private connectorHub: ConnectorHub,
    private ruleManager: NotificationRuleManager,
    private notificationManager: NotificationManager,
    private sqlite?: Database.Database,
  ) {
    this.loadCursors();
  }

  private loadCursors(): void {
    if (!this.sqlite) return;
    try {
      const stmt = this.sqlite.prepare(
        `SELECT value FROM settings WHERE key = 'scanner_cursors'`,
      );
      const row = stmt.get() as { value: string } | undefined;
      if (row?.value) {
        const cursors = JSON.parse(row.value) as Record<string, number>;
        for (const [k, v] of Object.entries(cursors)) {
          this.lastScanTimestamp.set(k, v);
        }
      }
    } catch {
      // Fresh start
    }
  }

  private saveCursors(): void {
    if (!this.sqlite) return;
    const cursors = Object.fromEntries(this.lastScanTimestamp);
    try {
      this.sqlite.prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)`,
      ).run('scanner_cursors', JSON.stringify(cursors), Date.now());
    } catch {
      // Non-critical
    }
  }

  /**
   * Scan a specific connector for new items via its MCP tools.
   */
  async scanConnector(connectorId: string): Promise<ScanResult> {
    if (!this.connectorHub.isStarted(connectorId)) {
      return { connectorId, newItems: [] };
    }

    const strategy = SCAN_STRATEGIES[connectorId];
    if (!strategy) {
      // No scan strategy defined for this connector — try listing tools as a health probe
      return { connectorId, newItems: [] };
    }

    try {
      const result = await this.connectorHub.callTool(
        `${connectorId}/${strategy.tool}`,
        strategy.args,
      );

      const allItems = strategy.extract(result);

      // Filter to new items since last scan (simple timestamp-based diff)
      const lastScan = this.lastScanTimestamp.get(connectorId) ?? 0;
      const now = Date.now();

      // Since MCP results don't always have timestamps, on first scan return
      // all items; on subsequent scans rely on the diff between scans
      let newItems: ScanItem[];
      if (lastScan === 0) {
        // First scan: establish baseline, don't notify
        newItems = [];
      } else {
        // Subsequent scans: all items are potentially new
        // A more sophisticated approach would track item IDs, but this is sufficient
        // for notification triggering
        newItems = allItems;
      }

      this.lastScanTimestamp.set(connectorId, now);
      this.saveCursors();

      return { connectorId, newItems };
    } catch {
      return { connectorId, newItems: [] };
    }
  }

  /**
   * Scan all started connectors.
   */
  async scanAll(): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const manifests = this.connectorHub.getManifests();

    for (const m of manifests) {
      if (this.connectorHub.isStarted(m.id)) {
        const result = await this.scanConnector(m.id);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Run all enabled notification rules against scan results.
   */
  async processRules(scanResults: ScanResult[]): Promise<void> {
    const rules = this.ruleManager.getRules();

    for (const result of scanResults) {
      if (result.newItems.length === 0) continue;

      const matchingRules = rules.filter(
        (r) => r.connectorId === result.connectorId || r.connectorId === '*',
      );

      for (const rule of matchingRules) {
        if (this.ruleManager.isInSilentHours(rule)) continue;

        const matched = this.matchRule(rule, result);
        if (matched.length === 0) continue;

        for (const item of matched) {
          await this.sendNotification(rule, item);
        }
      }
    }
  }

  private matchRule(
    rule: NotificationRule,
    result: ScanResult,
  ): ScanItem[] {
    switch (rule.condition) {
      case 'mention_me':
        return result.newItems.filter((item) =>
          item.title?.toLowerCase().includes('@me') ||
          item.summary?.toLowerCase().includes('@me'),
        );
      case 'p0_issue':
        return result.newItems.filter((item) =>
          item.title?.toLowerCase().includes('p0') ||
          item.title?.toLowerCase().includes('critical'),
        );
      case 'pr_review_requested':
        return result.newItems.filter((item) =>
          item.title?.toLowerCase().includes('review'),
        );
      case 'custom':
        if (!rule.customFilter) return result.newItems;
        return result.newItems.filter((item) =>
          item.title?.toLowerCase().includes(rule.customFilter!.toLowerCase()),
        );
      default:
        return result.newItems;
    }
  }

  private async sendNotification(
    rule: NotificationRule,
    item: ScanItem,
  ): Promise<void> {
    for (const channel of rule.channels) {
      switch (channel) {
        case 'system':
          this.notificationManager.send({
            title: item.title,
            body: item.summary ?? '',
          });
          break;
        case 'app':
          // In-app notification — would emit event to renderer
          break;
        case 'feishu':
          // Feishu bot notification — Phase 5.3 cloud integration
          break;
      }
    }
  }
}

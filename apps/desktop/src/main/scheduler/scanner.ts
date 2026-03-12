import type { ConnectorHub } from '../connectors/hub';
import type { NotificationRuleManager, NotificationRule } from './notification-rules';
import type { NotificationManager } from '../system/notifications';

interface ScanResult {
  connectorId: string;
  newItems: Array<{ title: string; summary?: string; url?: string }>;
}

/**
 * Scanner: periodically checks connectors for new data and triggers
 * notifications based on matching rules.
 */
export class Scanner {
  constructor(
    private connectorHub: ConnectorHub,
    private ruleManager: NotificationRuleManager,
    private notificationManager: NotificationManager,
  ) {}

  /**
   * Scan a specific connector for new items.
   * Uses the connector's tool listing as a proxy for data (actual sync integration later).
   */
  async scanConnector(connectorId: string): Promise<ScanResult> {
    // Placeholder: in a full implementation, this would call the connector's
    // fetch/discover methods and compare with last sync cursor
    return {
      connectorId,
      newItems: [],
    };
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
  ): Array<{ title: string; summary?: string }> {
    // Simple matching based on condition type
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
    item: { title: string; summary?: string },
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

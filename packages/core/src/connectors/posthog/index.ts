import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { config } from '../../config.js';
import { httpRequest } from '../../utils/http.js';
import { cacheGet, cacheSet } from '../base.js';
import { upsertObject, getObjectByUri } from '../../datamap/objects.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('posthog-connector');

const POSTHOG_API = process.env['POSTHOG_API_HOST'] ?? 'https://us.posthog.com/api';
const PROJECT_ID = parseInt(process.env['POSTHOG_PROJECT_ID'] ?? '0', 10);

const TTL = {
  dashboard: 86400,  // 24h — 静态
  insight: 14400,    // 4h — 稳定
} as const;

// ─── PostHog API 辅助 ───

async function phApi<T>(path: string): Promise<T> {
  const apiKey = config.posthog.api_key;
  if (!apiKey) throw new Error('PostHog API key not configured');

  const resp = await httpRequest<T>(`${POSTHOG_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 20_000,
  });

  if (!resp.ok) throw new Error(`PostHog API error: ${resp.status}`);
  return resp.data;
}

// ─── PostHog Connector ───

export class PostHogConnector implements Connector {
  readonly id = 'posthog_v1';
  readonly source: DataSource = 'posthog';

  async discover(): Promise<DataObject[]> {
    if (!config.posthog.api_key) {
      log.warn('PostHog API key not configured, skipping discovery');
      return [];
    }

    const objects: DataObject[] = [];

    try {
      const dashboards = await this.discoverDashboards();
      objects.push(...dashboards);

      const insights = await this.discoverInsights();
      objects.push(...insights);
    } catch (err) {
      log.error('PostHog discovery failed', err);
    }

    for (const obj of objects) {
      upsertObject(obj);
    }

    log.info(`PostHog discover complete: ${objects.length} objects indexed`);
    return objects;
  }

  async fetch(
    uri: string,
    _userContext: { user_id: string; role: Role },
  ): Promise<{ content: string; content_type: string; cached: boolean }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const parsed = this.parseUri(uri);
    if (!parsed) throw new Error(`Invalid PostHog URI: ${uri}`);

    let content: string;

    switch (parsed.type) {
      case 'dashboard':
        content = await this.fetchDashboardDetail(parsed.id);
        break;
      case 'insight':
        content = await this.fetchInsightDetail(parsed.id);
        break;
      default:
        throw new Error(`Unsupported PostHog resource: ${parsed.type}`);
    }

    const obj = getObjectByUri(uri);
    const ttl = obj?.ttl_seconds ?? (TTL as Record<string, number>)[parsed.type] ?? 14400;
    cacheSet(uri, content, 'text/markdown', ttl);

    return { content, content_type: 'text/markdown', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      await phApi(`/projects/${PROJECT_ID}/`);
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return { ok: false, latency_ms: Date.now() - start, error: String(err) };
    }
  }

  // ─── 内部方法 ───

  private async discoverDashboards(): Promise<DataObject[]> {
    const data = await phApi<{
      results: { id: number; name: string; description: string; created_at: string; created_by: { first_name: string } | null; pinned: boolean }[];
    }>(`/projects/${PROJECT_ID}/dashboards/`);

    const now = new Date().toISOString();
    return data.results.map(d => ({
      object_id: `dm_posthog_dash_${d.id}`,
      source: 'posthog' as DataSource,
      source_type: 'dashboard' as const,
      uri: `posthog://dashboard/${d.id}`,
      external_url: `https://us.posthog.com/project/${PROJECT_ID}/dashboard/${d.id}`,
      title: d.name,
      summary: d.description?.slice(0, 200),
      sensitivity: 'internal' as const,
      acl: { read: ['role:all_staff'] },
      tags: ['analytics', 'dashboard', ...(d.pinned ? ['pinned'] : [])],
      owner: d.created_by?.first_name,
      created_at: d.created_at,
      updated_at: d.created_at,
      last_indexed_at: now,
      ttl_seconds: TTL.dashboard,
      connector_id: this.id,
      data_scope: 'public',
      metadata: { posthog_id: d.id, pinned: d.pinned },
    }));
  }

  private async discoverInsights(): Promise<DataObject[]> {
    const data = await phApi<{
      results: {
        id: number; short_id: string; name: string; description: string;
        created_at: string; last_modified_at: string;
        created_by: { first_name: string } | null;
        filters: { insight?: string };
        saved: boolean;
      }[];
    }>(`/projects/${PROJECT_ID}/insights/?limit=100&saved=true`);

    const now = new Date().toISOString();
    return data.results.map(i => ({
      object_id: `dm_posthog_insight_${i.id}`,
      source: 'posthog' as DataSource,
      source_type: 'insight' as const,
      uri: `posthog://insight/${i.id}`,
      external_url: `https://us.posthog.com/project/${PROJECT_ID}/insights/${i.short_id}`,
      title: i.name || `Insight #${i.id}`,
      summary: i.description?.slice(0, 200),
      sensitivity: 'internal' as const,
      acl: { read: ['role:all_staff'] },
      tags: ['analytics', 'insight', i.filters?.insight?.toLowerCase()].filter(Boolean) as string[],
      owner: i.created_by?.first_name,
      created_at: i.created_at,
      updated_at: i.last_modified_at || i.created_at,
      last_indexed_at: now,
      ttl_seconds: TTL.insight,
      connector_id: this.id,
      data_scope: 'public',
      metadata: { posthog_id: i.id, short_id: i.short_id, insight_type: i.filters?.insight },
    }));
  }

  private async fetchDashboardDetail(id: number): Promise<string> {
    const d = await phApi<{
      name: string; description: string; pinned: boolean;
      tiles: { insight: { name: string; filters: { insight: string }; description: string } | null }[];
      created_at: string;
    }>(`/projects/${PROJECT_ID}/dashboards/${id}/`);

    let md = `# Dashboard: ${d.name}\n\n`;
    md += `**Pinned**: ${d.pinned ? 'Yes' : 'No'}\n`;
    md += `**Created**: ${d.created_at}\n\n`;
    if (d.description) md += `${d.description}\n\n`;

    const tiles = d.tiles?.filter(t => t.insight) ?? [];
    if (tiles.length) {
      md += `## Insights (${tiles.length})\n\n`;
      for (const t of tiles) {
        if (t.insight) {
          md += `- **${t.insight.name || '(unnamed)'}** [${t.insight.filters?.insight || '?'}]\n`;
          if (t.insight.description) md += `  ${t.insight.description}\n`;
        }
      }
    }

    return md;
  }

  private async fetchInsightDetail(id: number): Promise<string> {
    const i = await phApi<{
      name: string; description: string; short_id: string;
      filters: Record<string, unknown>;
      result: unknown;
      created_at: string; last_modified_at: string;
    }>(`/projects/${PROJECT_ID}/insights/${id}/`);

    let md = `# Insight: ${i.name || `#${id}`}\n\n`;
    md += `**Type**: ${(i.filters as { insight?: string }).insight || 'unknown'}\n`;
    md += `**Created**: ${i.created_at}\n`;
    md += `**Last Modified**: ${i.last_modified_at}\n\n`;
    if (i.description) md += `${i.description}\n\n`;

    md += `## Filters\n\n\`\`\`json\n${JSON.stringify(i.filters, null, 2).slice(0, 2000)}\n\`\`\`\n\n`;

    if (i.result) {
      md += `## Result (preview)\n\n\`\`\`json\n${JSON.stringify(i.result, null, 2).slice(0, 3000)}\n\`\`\`\n`;
    }

    return md;
  }

  private parseUri(uri: string): { type: string; id: number } | null {
    const match = uri.match(/^posthog:\/\/(dashboard|insight)\/(\d+)$/);
    if (!match) return null;
    return { type: match[1], id: parseInt(match[2]) };
  }
}

import Database from 'better-sqlite3';
import { GoalManager } from './manager.js';
import { loadCredential } from '../connectors/credential-store.js';
import { logInfo, logError } from '../utils/logger.js';

export interface PollResult {
  polled: number;
  updated: number;
  errors: number;
}

/**
 * Poll all active signals that are due for update.
 * Called by daemon cron or manually.
 */
export async function pollSignals(sqlite: Database.Database): Promise<PollResult> {
  const gm = new GoalManager(sqlite);
  const now = Date.now();
  let polled = 0, updated = 0, errors = 0;

  // Find signals due for polling (last_polled_at + poll_interval < now, or never polled)
  const dueSignals = sqlite.prepare(`
    SELECT s.*, g.status as goal_status FROM signals s
    JOIN goals g ON g.id = s.goal_id
    WHERE g.status = 'active'
    AND (s.last_polled_at IS NULL OR s.last_polled_at + (s.poll_interval * 1000) < ?)
    ORDER BY s.last_polled_at ASC
    LIMIT 50
  `).all(now) as Array<{
    id: string; goal_id: string; title: string; source: string;
    metric: string; direction: string; poll_interval: number;
    config: string | null; current_value: number | null; last_polled_at: number | null;
  }>;

  logInfo('poller', `Found ${dueSignals.length} signals due for polling`);

  for (const signal of dueSignals) {
    polled++;
    try {
      const value = await fetchMetricValue(signal.source, signal.metric, signal.config);
      if (value !== null) {
        gm.updateSignalValue(signal.id, value);
        updated++;
        logInfo('poller', `Signal ${signal.title}: ${signal.current_value ?? 'N/A'} → ${value}`, {
          signalId: signal.id, source: signal.source, metric: signal.metric,
        });
      }
    } catch (err) {
      errors++;
      logError('poller', `Failed to poll signal ${signal.title}`, {
        signalId: signal.id, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { polled, updated, errors };
}

/**
 * Fetch a metric value from the appropriate data source.
 * Returns null if the source/metric is not supported or unavailable.
 */
async function fetchMetricValue(
  source: string,
  metric: string,
  configJson: string | null,
): Promise<number | null> {
  const config = configJson ? JSON.parse(configJson) as Record<string, unknown> : {};

  switch (source) {
    case 'github': {
      const cred = loadCredential('github');
      if (!cred) return null;
      return fetchGitHubMetric(cred.data.token, metric, config);
    }
    case 'feishu': {
      const cred = loadCredential('feishu');
      if (!cred) return null;
      return fetchFeishuMetric(cred.data, metric);
    }
    case 'gitlab': {
      const cred = loadCredential('gitlab');
      if (!cred) return null;
      return fetchGitLabMetric(cred.data, metric, config);
    }
    case 'linear': {
      const cred = loadCredential('linear');
      if (!cred) return null;
      return fetchLinearMetric(cred.data, metric, config);
    }
    case 'posthog': {
      const cred = loadCredential('posthog');
      if (!cred) return null;
      return fetchPostHogMetric(cred.data, metric, config);
    }
    case 'manual': {
      // Manual signals don't auto-poll — they're updated via MCP update_goal or CLI
      return null;
    }
    default:
      logInfo('poller', `Source "${source}" not supported for auto-polling`);
      return null;
  }
}

async function fetchGitHubMetric(
  token: string,
  metric: string,
  config: Record<string, unknown>,
): Promise<number | null> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'jowork/0.1.0',
  };

  switch (metric) {
    case 'open_issues': {
      const repo = config.repo as string | undefined;
      if (!repo) return null;
      const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
      if (!res.ok) return null;
      const data = await res.json() as { open_issues_count: number };
      return data.open_issues_count;
    }
    case 'open_prs': {
      const repo = config.repo as string | undefined;
      if (!repo) return null;
      const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=1`, { headers });
      if (!res.ok) return null;
      // Use Link header to get total count
      const link = res.headers.get('link');
      if (link && link.includes('rel="last"')) {
        const match = link.match(/page=(\d+)>; rel="last"/);
        return match ? parseInt(match[1]) : 0;
      }
      const data = await res.json() as unknown[];
      return data.length;
    }
    case 'stars': {
      const repo = config.repo as string | undefined;
      if (!repo) return null;
      const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
      if (!res.ok) return null;
      const data = await res.json() as { stargazers_count: number };
      return data.stargazers_count;
    }
    default:
      return null;
  }
}

async function fetchFeishuMetric(
  data: Record<string, string>,
  metric: string,
): Promise<number | null> {
  const { appId, appSecret } = data;
  if (!appId || !appSecret) return null;

  // Get token
  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const tokenData = await tokenRes.json() as { code: number; tenant_access_token: string };
  if (tokenData.code !== 0) return null;
  const token = tokenData.tenant_access_token;

  switch (metric) {
    case 'chat_count': {
      const res = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const chats = await res.json() as { data: { items: unknown[] } };
      return chats.data?.items?.length ?? 0;
    }
    default:
      return null;
  }
}

async function fetchGitLabMetric(
  data: Record<string, string>,
  metric: string,
  config: Record<string, unknown>,
): Promise<number | null> {
  const { token, apiUrl } = data;
  if (!token) return null;
  const baseUrl = apiUrl || 'https://gitlab.com';
  const headers = { 'PRIVATE-TOKEN': token };

  switch (metric) {
    case 'open_issues': {
      const project = config.project as string | undefined;
      if (!project) return null;
      const encoded = encodeURIComponent(project);
      const res = await fetch(`${baseUrl}/api/v4/projects/${encoded}?statistics=true`, { headers });
      if (!res.ok) return null;
      const d = await res.json() as { open_issues_count: number };
      return d.open_issues_count;
    }
    case 'open_mrs': {
      const project = config.project as string | undefined;
      if (!project) return null;
      const encoded = encodeURIComponent(project);
      const res = await fetch(`${baseUrl}/api/v4/projects/${encoded}/merge_requests?state=opened&per_page=1`, { headers });
      if (!res.ok) return null;
      const total = res.headers.get('x-total');
      return total ? parseInt(total) : 0;
    }
    default:
      return null;
  }
}

async function fetchLinearMetric(
  data: Record<string, string>,
  metric: string,
  config: Record<string, unknown>,
): Promise<number | null> {
  const { apiKey } = data;
  if (!apiKey) return null;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: apiKey,
  };

  switch (metric) {
    case 'open_issues': {
      const teamKey = config.team as string | undefined;
      const filter = teamKey
        ? `filter: { team: { key: { eq: "${teamKey}" } }, state: { type: { nin: ["completed", "canceled"] } } }`
        : `filter: { state: { type: { nin: ["completed", "canceled"] } } }`;
      const query = `{ issueConnection(${filter}) { pageInfo { totalCount } } }`;
      const res = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
      });
      if (!res.ok) return null;
      const body = await res.json() as { data?: { issueConnection?: { pageInfo?: { totalCount?: number } } } };
      return body.data?.issueConnection?.pageInfo?.totalCount ?? null;
    }
    default:
      return null;
  }
}

async function fetchPostHogMetric(
  data: Record<string, string>,
  metric: string,
  config: Record<string, unknown>,
): Promise<number | null> {
  const { apiKey, host, projectId: rawProjectId } = data;
  if (!apiKey) return null;
  const baseUrl = host || 'https://app.posthog.com';
  const projectId = rawProjectId || '1';

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  switch (metric) {
    case 'dau': {
      // Query daily active users via trends
      const res = await fetch(`${baseUrl}/api/projects/${projectId}/insights/trend/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          events: [{ id: '$pageview', type: 'events', math: 'dau' }],
          date_from: '-1d',
        }),
      });
      if (!res.ok) return null;
      const body = await res.json() as { result?: Array<{ data: number[] }> };
      const values = body.result?.[0]?.data;
      return values?.[values.length - 1] ?? null;
    }
    case 'retention': {
      const res = await fetch(`${baseUrl}/api/projects/${projectId}/insights/retention/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          target_event: { id: '$pageview', type: 'events' },
          returning_event: { id: '$pageview', type: 'events' },
          date_from: '-7d',
          period: 'Day',
        }),
      });
      if (!res.ok) return null;
      const rdata = await res.json() as { result?: Array<{ values: Array<{ count: number }> }> };
      // Return day-1 retention rate as percentage
      const firstDay = rdata.result?.[0]?.values;
      if (!firstDay || firstDay.length < 2) return null;
      return Math.round((firstDay[1].count / firstDay[0].count) * 100);
    }
    case 'crash_rate': {
      const eventName = (config.crashEvent as string) ?? '$exception';
      const res = await fetch(`${baseUrl}/api/projects/${projectId}/events/?event=${eventName}&limit=1`, { headers });
      if (!res.ok) return null;
      const edata = await res.json() as { results?: unknown[] };
      return edata.results?.length ?? 0;
    }
    default:
      return null;
  }
}

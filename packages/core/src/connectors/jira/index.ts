import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import { config } from '../../config.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';

const log = createLogger('jira-connector');
const CACHE_TTL_S = 300;

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_AUDIENCE = 'api.atlassian.com';

function jiraApiBase(): string {
  if (!config.atlassian.cloud_id) throw new Error('ATLASSIAN_CLOUD_ID not configured');
  return `https://api.atlassian.com/ex/jira/${config.atlassian.cloud_id}/rest/api/3`;
}

async function jiraGet<T>(path: string, token: string): Promise<T> {
  const res = await httpRequest<T>(`${jiraApiBase()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return res.data;
}

export class JiraConnector implements Connector {
  readonly id = 'jira_v1';
  readonly source: DataSource = 'jira';

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.atlassian;
    if (!client_id) throw new Error('ATLASSIAN_CLIENT_ID not configured');
    const params = new URLSearchParams({
      audience: ATLASSIAN_AUDIENCE,
      client_id,
      scope: 'read:jira-work offline_access',
      redirect_uri: redirectUri,
      response_type: 'code',
      prompt: 'consent',
      state,
    });
    return `${ATLASSIAN_AUTH_URL}?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string): Promise<void> {
    const { client_id, client_secret } = config.atlassian;
    if (!client_id || !client_secret) throw new Error('ATLASSIAN_CLIENT_ID/SECRET not configured');

    const resp = await httpRequest<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    }>(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id,
        client_secret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    saveOAuthCredentials('jira_v1', {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_at: Date.now() + resp.data.expires_in * 1000,
      scope: resp.data.scope,
    });
    log.info('Jira OAuth token saved');
  }

  private getToken(): string {
    const creds = getOAuthCredentials('jira_v1');
    if (!creds?.access_token) throw new Error('Jira not connected. Please authorize via OAuth.');
    return creds.access_token;
  }

  async discover(): Promise<DataObject[]> {
    let token: string;
    try { token = this.getToken(); } catch {
      log.warn('Jira not connected, skipping discovery');
      return [];
    }

    const objects: DataObject[] = [];
    try {
      interface JiraIssue { id: string; key: string; fields: { summary: string; updated: string } }
      interface JiraSearchResp { issues: JiraIssue[] }
      const data = await jiraGet<JiraSearchResp>(
        '/search?jql=ORDER%20BY%20updated%20DESC&maxResults=50&fields=summary,updated',
        token,
      );

      for (const issue of data.issues ?? []) {
        const uri = `jira://issues/${issue.id}`;
        const obj: Partial<DataObject> = {
          uri,
          source: 'jira',
          source_type: 'issue',
          title: `${issue.key} ${issue.fields.summary}`,
          sensitivity: 'internal',
          tags: ['jira', 'issue'],
          updated_at: issue.fields.updated,
          connector_id: this.id,
          acl: { read: ['role:all_staff'] },
        };
        await upsertObject(obj as DataObject);
        objects.push(obj as DataObject);
      }
    } catch (err) {
      log.error('Jira discovery failed', err);
    }

    return objects;
  }

  async fetch(uri: string, _userContext: { user_id: string; role: Role }): Promise<{ content: string; content_type: string; cached: boolean }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const match = uri.match(/^jira:\/\/issues\/(.+)$/);
    if (!match) throw new Error(`Invalid Jira URI: ${uri}`);
    const [, issueId] = match;

    const token = this.getToken();
    interface JiraIssueResp {
      key: string;
      fields: {
        summary: string;
        description?: unknown;
        status?: { name?: string };
        assignee?: { displayName?: string };
        updated: string;
      };
    }

    const issue = await jiraGet<JiraIssueResp>(`/issue/${issueId}?fields=summary,description,status,assignee,updated`, token);
    const desc = typeof issue.fields.description === 'string' ? issue.fields.description : JSON.stringify(issue.fields.description ?? '');
    const content = [
      `# ${issue.key} ${issue.fields.summary}`,
      `**Status:** ${issue.fields.status?.name ?? ''}`,
      `**Assignee:** ${issue.fields.assignee?.displayName ?? ''}`,
      `**Updated:** ${issue.fields.updated}`,
      '',
      desc,
    ].join('\n');

    cacheSet(uri, content, 'text/markdown', CACHE_TTL_S);
    return { content, content_type: 'text/markdown', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    try {
      const token = this.getToken();
      const t0 = Date.now();
      await jiraGet('/myself', token);
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latency_ms: -1, error: String(err) };
    }
  }
}

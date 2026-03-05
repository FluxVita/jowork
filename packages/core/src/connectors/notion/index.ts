/**
 * Notion Connector
 *
 * 索引 Notion 数据库和页面内容。
 *
 * 认证方式：Integration Token
 * 环境变量：
 *   NOTION_TOKEN         — Notion Internal Integration Token（必填）
 *   NOTION_DATABASE_IDS  — 逗号分隔的数据库 ID 列表（可选，不填则搜索所有可访问数据库）
 */

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import type { JoworkConnector, ConnectorManifest, ConnectorConfig, EncryptedCredentials } from '../protocol.js';
import { config } from '../../config.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';

const log = createLogger('notion-connector');

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const CACHE_TTL_S = 600; // 10 分钟
const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';

function getToken(): string {
  const creds = getOAuthCredentials('notion_v1');
  if (creds?.access_token) return creds.access_token;
  return process.env['NOTION_TOKEN'] ?? '';
}

function getDatabaseIds(): string[] {
  const raw = process.env['NOTION_DATABASE_IDS'] ?? '';
  return raw.split(',').map(r => r.trim()).filter(Boolean);
}

// ─── HTTP 辅助 ────────────────────────────────────────────────────────────────

async function notionGet<T>(path: string): Promise<T> {
  const res = await httpRequest<T>(`${NOTION_API}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Notion-Version': NOTION_VERSION,
    },
  });
  return res.data;
}

async function notionPost<T>(path: string, body: unknown): Promise<T> {
  const res = await httpRequest<T>(`${NOTION_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.data;
}

// ─── Notion 类型 ──────────────────────────────────────────────────────────────

interface NotionPage {
  id: string;
  object: 'page';
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, NotionProperty>;
  parent: { type: string; database_id?: string; page_id?: string };
}

interface NotionProperty {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  select?: { name: string } | null;
  multi_select?: Array<{ name: string }>;
  date?: { start: string } | null;
  checkbox?: boolean;
  number?: number | null;
  url?: string | null;
}

interface NotionDatabase {
  id: string;
  title: Array<{ plain_text: string }>;
  url: string;
  last_edited_time: string;
}

interface NotionBlock {
  type: string;
  paragraph?: { rich_text: Array<{ plain_text: string }> };
  heading_1?: { rich_text: Array<{ plain_text: string }> };
  heading_2?: { rich_text: Array<{ plain_text: string }> };
  heading_3?: { rich_text: Array<{ plain_text: string }> };
  bulleted_list_item?: { rich_text: Array<{ plain_text: string }> };
  numbered_list_item?: { rich_text: Array<{ plain_text: string }> };
  to_do?: { rich_text: Array<{ plain_text: string }>; checked: boolean };
  code?: { rich_text: Array<{ plain_text: string }>; language: string };
  quote?: { rich_text: Array<{ plain_text: string }> };
  divider?: unknown;
  child_page?: { title: string };
}

// ─── 格式化辅助 ───────────────────────────────────────────────────────────────

function getPageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'title' && prop.title?.length) {
      return prop.title.map(t => t.plain_text).join('');
    }
  }
  return '(Untitled)';
}

function getPageTags(page: NotionPage): string[] {
  const tags: string[] = [];
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'select' && prop.select?.name) tags.push(prop.select.name);
    if (prop.type === 'multi_select') prop.multi_select?.forEach(s => tags.push(s.name));
  }
  return tags;
}

function richTextToStr(blocks: Array<{ plain_text: string }>): string {
  return blocks.map(b => b.plain_text).join('');
}

function blockToMarkdown(block: NotionBlock): string {
  switch (block.type) {
    case 'paragraph': return richTextToStr(block.paragraph?.rich_text ?? []);
    case 'heading_1': return `# ${richTextToStr(block.heading_1?.rich_text ?? [])}`;
    case 'heading_2': return `## ${richTextToStr(block.heading_2?.rich_text ?? [])}`;
    case 'heading_3': return `### ${richTextToStr(block.heading_3?.rich_text ?? [])}`;
    case 'bulleted_list_item': return `- ${richTextToStr(block.bulleted_list_item?.rich_text ?? [])}`;
    case 'numbered_list_item': return `1. ${richTextToStr(block.numbered_list_item?.rich_text ?? [])}`;
    case 'to_do': {
      const checked = block.to_do?.checked ? 'x' : ' ';
      return `- [${checked}] ${richTextToStr(block.to_do?.rich_text ?? [])}`;
    }
    case 'code': return `\`\`\`${block.code?.language ?? ''}\n${richTextToStr(block.code?.rich_text ?? [])}\n\`\`\``;
    case 'quote': return `> ${richTextToStr(block.quote?.rich_text ?? [])}`;
    case 'divider': return '---';
    case 'child_page': return `[子页面: ${block.child_page?.title}]`;
    default: return '';
  }
}

// ─── NotionConnector 实现 ─────────────────────────────────────────────────────

export class NotionConnector implements Connector {
  readonly manifest: ConnectorManifest = {
    id: 'notion',
    name: 'Notion',
    version: '1.0.0',
    description: 'Index Notion databases and pages as searchable knowledge',
    auth: {
      type: 'oauth2',
      authorize_url: NOTION_AUTH_URL,
      token_url: NOTION_TOKEN_URL,
      scopes: ['read_content'],
      docs_url: 'https://developers.notion.com/docs/authorization',
    },
    capabilities: ['discover', 'fetch'],
    data_types: ['page', 'database'],
    config_schema: {
      type: 'object',
      properties: {
        database_ids: {
          type: 'string',
          title: 'Database IDs',
          description: 'Comma-separated Notion database IDs to index (leave empty to auto-discover)',
        },
      },
    },
  };

  readonly id = 'notion_v1';
  readonly source: DataSource = 'notion';

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.notion;
    if (!client_id) throw new Error('NOTION_CLIENT_ID not configured');
    const params = new URLSearchParams({
      owner: 'user',
      client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `${NOTION_AUTH_URL}?${params.toString()}`;
  }

  async exchangeToken(code: string, redirectUri: string): Promise<void> {
    const { client_id, client_secret } = config.notion;
    if (!client_id || !client_secret) throw new Error('NOTION_CLIENT_ID/SECRET not configured');
    const basic = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
    const resp = await httpRequest<{
      access_token: string;
      workspace_name?: string;
      workspace_id?: string;
      bot_id?: string;
    }>(NOTION_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    saveOAuthCredentials('notion_v1', {
      access_token: resp.data.access_token,
      extra: {
        workspace_name: resp.data.workspace_name,
        workspace_id: resp.data.workspace_id,
        bot_id: resp.data.bot_id,
      },
    });
    log.info('Notion OAuth token saved');
  }

  async initialize(_config: ConnectorConfig, _credentials: EncryptedCredentials): Promise<void> {}
  async shutdown(): Promise<void> {}

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const token = getToken();
    if (!token) return { ok: false, latency_ms: -1, error: 'Notion not connected (OAuth or NOTION_TOKEN)' };
    const t0 = Date.now();
    try {
      await notionGet('/users/me');
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latency_ms: Date.now() - t0, error: String(err) };
    }
  }

  async discover(): Promise<DataObject[]> {
    const token = getToken();
    if (!token) {
      log.warn('Notion connector: not connected (OAuth or NOTION_TOKEN)');
      return [];
    }

    const dbIds = getDatabaseIds();
    const objects: DataObject[] = [];

    // 如果未配置数据库 ID，搜索所有可访问数据库
    let targetDbIds = dbIds;
    if (targetDbIds.length === 0) {
      try {
        const searchResult = await notionPost<{ results: NotionDatabase[] }>('/search', {
          filter: { property: 'object', value: 'database' },
          page_size: 50,
        });
        targetDbIds = searchResult.results.map(db => db.id);
        log.info(`Notion: auto-discovered ${targetDbIds.length} databases`);
      } catch (err) {
        log.error('Notion: failed to search databases', err);
        return [];
      }
    }

    for (const dbId of targetDbIds) {
      try {
        const result = await notionPost<{ results: NotionPage[] }>(
          `/databases/${dbId}/query`,
          { page_size: 100, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] },
        );

        for (const page of result.results) {
          const title = getPageTitle(page);
          const tags = getPageTags(page);
          const uri = `notion://${page.id}`;

          const partial = {
            uri,
            source: 'notion' as const,
            source_type: 'page' as const,
            title,
            sensitivity: 'internal' as const,
            tags: ['notion', ...tags],
            updated_at: page.last_edited_time,
            ttl_seconds: CACHE_TTL_S,
            connector_id: this.id,
            acl: { read: ['role:all_staff'] },
          };

          await upsertObject(partial);
          objects.push(partial as DataObject);
        }

        log.info(`Notion: indexed ${result.results.length} pages from database ${dbId}`);
      } catch (err) {
        log.error(`Notion: failed to query database ${dbId}`, err);
      }
    }

    return objects;
  }

  async fetch(uri: string, _userContext: { user_id: string; role: Role }): Promise<{
    content: string; content_type: string; cached: boolean;
  }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    // 解析 uri: notion://page-id
    const match = uri.match(/^notion:\/\/([a-z0-9-]+)$/);
    if (!match) throw new Error(`Invalid Notion URI: ${uri}`);

    const pageId = match[1];

    // 获取页面元数据
    const page = await notionGet<NotionPage>(`/pages/${pageId}`);
    const title = getPageTitle(page);

    // 获取页面内容块
    const blocksResult = await notionGet<{ results: NotionBlock[] }>(
      `/blocks/${pageId}/children?page_size=100`,
    );

    const body = blocksResult.results
      .map(blockToMarkdown)
      .filter(Boolean)
      .join('\n\n');

    const content = `# ${title}\n\n${body}`;

    cacheSet(uri, content, 'text/markdown', CACHE_TTL_S);
    return { content, content_type: 'text/markdown', cached: false };
  }
}

/** 单例实例 */
export const notionConnector = new NotionConnector();

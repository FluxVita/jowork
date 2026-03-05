import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { httpRequest } from '../../utils/http.js';
import { cacheGet, cacheSet } from '../base.js';
import { upsertObject, getObjectByUri } from '../../datamap/objects.js';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';

const log = createLogger('figma-connector');

const FIGMA_API = 'https://api.figma.com/v1';
const FIGMA_AUTH_URL = 'https://www.figma.com/oauth';
const FIGMA_TOKEN_URL = 'https://www.figma.com/api/oauth/token';

const TTL = {
  design_file: 14400,  // 4h
  component: 14400,
} as const;

// ─── Figma token 优先级：OAuth → env var ───

function getFigmaToken(): string {
  const creds = getOAuthCredentials('figma_v1');
  if (creds?.access_token) return creds.access_token;
  if (process.env['FIGMA_ACCESS_TOKEN']) return process.env['FIGMA_ACCESS_TOKEN'];
  throw new Error('Figma not connected. Please authorize via OAuth or set FIGMA_ACCESS_TOKEN.');
}

async function figmaApi<T>(path: string, token?: string): Promise<T> {
  const accessToken = token || getFigmaToken();
  if (!accessToken) throw new Error('Figma access token not configured');

  const resp = await httpRequest<T>(`${FIGMA_API}${path}`, {
    headers: { 'X-Figma-Token': accessToken },
    timeout: 20_000,
  });

  if (!resp.ok) throw new Error(`Figma API error: ${resp.status}`);
  return resp.data;
}

// ─── Figma Connector ───

export class FigmaConnector implements Connector {
  readonly id = 'figma_v1';
  readonly source: DataSource = 'figma';

  // ─── OAuth 支持 ───

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.figma;
    if (!client_id) throw new Error('FIGMA_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      scope: 'files:read',
      state,
      response_type: 'code',
    });
    return `${FIGMA_AUTH_URL}?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string): Promise<void> {
    const { client_id, client_secret } = config.figma;
    if (!client_id || !client_secret) throw new Error('FIGMA_CLIENT_ID/SECRET not configured');

    const credentials = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
    const resp = await httpRequest<{
      access_token: string;
      expires_in: number;
      refresh_token: string;
    }>(FIGMA_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    saveOAuthCredentials('figma_v1', {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_at: Date.now() + resp.data.expires_in * 1000,
    });
    log.info('Figma OAuth token saved');
  }

  /** 发现团队项目和文件 */
  async discover(): Promise<DataObject[]> {
    try { getFigmaToken(); } catch {
      log.warn('Figma not connected, skipping discovery');
      return [];
    }

    const objects: DataObject[] = [];

    try {
      // 获取最近打开的文件
      const files = await this.discoverRecentFiles();
      objects.push(...files);
    } catch (err) {
      log.error('Figma discovery failed', err);
    }

    for (const obj of objects) {
      upsertObject(obj);
    }

    log.info(`Figma discover complete: ${objects.length} objects indexed`);
    return objects;
  }

  async fetch(
    uri: string,
    _userContext: { user_id: string; role: Role },
  ): Promise<{ content: string; content_type: string; cached: boolean }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const parsed = this.parseUri(uri);
    if (!parsed) throw new Error(`Invalid Figma URI: ${uri}`);

    const content = await this.fetchFileDetail(parsed.fileKey);

    const obj = getObjectByUri(uri);
    const ttl = obj?.ttl_seconds ?? TTL.design_file;
    cacheSet(uri, content, 'text/markdown', ttl);

    return { content, content_type: 'text/markdown', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      await figmaApi('/me');
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return { ok: false, latency_ms: Date.now() - start, error: String(err) };
    }
  }

  // ─── 内部方法 ───

  /** 获取用户最近的文件（通过 team projects） */
  private async discoverRecentFiles(): Promise<DataObject[]> {
    // Figma API 没有直接的"最近文件"接口，先用 /me 拿用户信息
    const me = await figmaApi<{ id: string; handle: string; email: string }>('/me');
    log.info(`Figma user: ${me.handle} (${me.email})`);

    // 尝试获取团队项目（需要 team_id，这里先返回空，等用户配置团队）
    // Figma REST API 需要 team_id 才能列项目
    // 实际使用中通过 Figma MCP 工具更方便
    return [];
  }

  /** 获取文件详情 */
  private async fetchFileDetail(fileKey: string): Promise<string> {
    const file = await figmaApi<{
      name: string;
      lastModified: string;
      version: string;
      document: { children: { name: string; type: string }[] };
    }>(`/files/${fileKey}?depth=1`);

    let md = `# Figma: ${file.name}\n\n`;
    md += `**Last Modified**: ${file.lastModified}\n`;
    md += `**Version**: ${file.version}\n\n`;

    if (file.document.children?.length) {
      md += `## Pages (${file.document.children.length})\n\n`;
      for (const page of file.document.children) {
        md += `- ${page.name} (${page.type})\n`;
      }
    }

    return md;
  }

  /** 注册已知的 Figma 文件到数据地图 */
  registerFile(fileKey: string, name: string, url: string) {
    const now = new Date().toISOString();
    upsertObject({
      source: 'figma',
      source_type: 'design_file',
      uri: `figma://file/${fileKey}`,
      external_url: url,
      title: name,
      sensitivity: 'internal',
      acl: { read: ['role:member', 'role:admin', 'role:owner'] },
      tags: ['design'],
      updated_at: now,
      ttl_seconds: TTL.design_file,
      connector_id: this.id,
      data_scope: 'personal',
      metadata: { file_key: fileKey },
    });
  }

  private parseUri(uri: string): { fileKey: string; nodeId?: string } | null {
    const match = uri.match(/^figma:\/\/file\/([a-zA-Z0-9]+)(?:\/node\/(.+))?$/);
    if (!match) return null;
    return { fileKey: match[1], nodeId: match[2] };
  }
}

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { feishuApi } from './auth.js';
import { cacheGet, cacheSet, cacheInvalidate } from '../base.js';
import { upsertObject, getObjectByUri } from '../../datamap/objects.js';
import { saveContent, readContentByPath } from '../../datamap/content-store.js';
import { trackApiCall, canCallFeishu } from '../../quota/manager.js';
import { getCursor, setCursor } from '../sync-state.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('feishu-connector');

// ─── 飞书 API 响应类型 ───

interface FeishuListResp<T> {
  code: number;
  msg: string;
  data: {
    items: T[];
    has_more: boolean;
    page_token?: string;
  };
}

interface FeishuDocMeta {
  doc_token: string;
  doc_type: string;
  title: string;
  owner_id: string;
  create_time: string;
  update_time: string;
}

interface FeishuWikiNode {
  space_id: string;
  node_token: string;
  obj_token: string;
  obj_type: string;
  title: string;
  creator: string;
  create_time: string;
  update_time: string;
  has_child: boolean;
}

interface FeishuWikiSpace {
  space_id: string;
  name: string;
  description: string;
}

interface FeishuDocContent {
  code: number;
  msg: string;
  data: {
    content: string;
  };
}

// ─── TTL 策略 ───
const TTL = {
  document: 900,   // 15min — 频变
  wiki: 900,
  message: 0,      // 实时
  calendar: 14400,  // 4h — 稳定
} as const;

function getTtl(type: string): number {
  return (TTL as Record<string, number>)[type] ?? 900;
}

// ─── Feishu Connector ───

export class FeishuConnector implements Connector {
  readonly id = 'feishu_v1';
  readonly source: DataSource = 'feishu';

  /** 发现数据对象：遍历 wiki 空间和文档（支持增量） */
  async discover(): Promise<DataObject[]> {
    if (!canCallFeishu('doc_discovery')) {
      log.warn('Feishu quota insufficient, skipping discovery');
      return [];
    }

    const cursor = getCursor(this.id, 'last_indexed_at');
    const isIncremental = !!cursor;
    if (isIncremental) {
      log.info(`Feishu incremental discover from ${cursor}`);
    }

    const objects: DataObject[] = [];

    try {
      const wikiObjects = await this.discoverWikiSpaces(cursor ?? undefined);
      objects.push(...wikiObjects);
    } catch (err) {
      log.error('Wiki discovery failed', err);
    }

    // 只 upsert 有变化的对象（增量模式下跳过未变化的）
    for (const obj of objects) {
      upsertObject(obj);
    }

    // 更新 cursor 到当前时间
    setCursor(this.id, 'last_indexed_at', new Date().toISOString());

    log.info(`Feishu discover complete: ${objects.length} objects indexed (${isIncremental ? 'incremental' : 'full'})`);
    return objects;
  }

  /** 按需拉取文档内容（本地文件优先） */
  async fetch(
    uri: string,
    _userContext: { user_id: string; role: Role },
  ): Promise<{ content: string; content_type: string; cached: boolean }> {
    // 优先查本地全文文件
    const obj = getObjectByUri(uri);
    if (obj?.content_path) {
      const localContent = readContentByPath(obj.content_path);
      if (localContent) {
        return { content: localContent, content_type: 'text/markdown', cached: true };
      }
    }

    // 再查加密缓存
    const cached = cacheGet(uri);
    if (cached) {
      return { content: cached.content, content_type: cached.content_type, cached: true };
    }

    if (!canCallFeishu('doc_fetch')) {
      throw new Error('Feishu API quota exhausted');
    }

    // 解析 URI: lark://wiki/{token} 或 lark://doc/{token}
    const parsed = this.parseUri(uri);
    if (!parsed) throw new Error(`Invalid Feishu URI: ${uri}`);

    let content: string;
    let contentType = 'text/markdown';

    if (parsed.type === 'wiki' || parsed.type === 'doc' || parsed.type === 'docx') {
      content = await this.fetchDocContent(parsed.token, parsed.type);
      trackApiCall('feishu', 'doc_fetch');
    } else {
      throw new Error(`Unsupported Feishu resource type: ${parsed.type}`);
    }

    // 存到本地文件
    if (content && obj) {
      try {
        const contentPath = saveContent('feishu_doc', obj.object_id, content);
        upsertObject({ ...obj, content_path: contentPath, content_length: content.length });
      } catch (err) {
        log.debug('Failed to save content locally', err);
      }
    }

    // 获取对象元数据以确定 TTL
    const ttl = obj ? obj.ttl_seconds : getTtl(parsed.type);

    // 写入加密缓存
    cacheSet(uri, content, contentType, ttl);

    return { content, content_type: contentType, cached: false };
  }

  /** 健康检查 */
  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      await feishuApi('/auth/v3/app_access_token/internal', {
        method: 'POST',
        body: {
          app_id: 'health_check',
          app_secret: 'health_check',
        },
      });
      // 即使返回错误码也说明 API 可达
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return { ok: false, latency_ms: Date.now() - start, error: String(err) };
    }
  }

  // ─── 内部方法 ───

  /** 发现 Wiki 空间下的所有节点（支持增量过滤） */
  private async discoverWikiSpaces(sinceIso?: string): Promise<DataObject[]> {
    const objects: DataObject[] = [];

    const spacesResp = await feishuApi<FeishuListResp<FeishuWikiSpace>>(
      '/wiki/v2/spaces',
      { params: { page_size: '50' } },
    );
    trackApiCall('feishu', 'doc_discovery');

    if (spacesResp.code !== 0 || !spacesResp.data?.items) {
      log.warn('No wiki spaces found or API error', spacesResp.msg);
      return objects;
    }

    for (const space of spacesResp.data.items) {
      try {
        const nodes = await this.discoverWikiNodes(space.space_id, undefined, 0, sinceIso);
        objects.push(...nodes);
      } catch (err) {
        log.error(`Failed to discover wiki space ${space.name}`, err);
      }
    }

    return objects;
  }

  /** 递归发现 Wiki 空间下的节点（增量：只返回 update_time > cursor 的节点） */
  private async discoverWikiNodes(
    spaceId: string,
    parentToken?: string,
    depth = 0,
    sinceIso?: string,
  ): Promise<DataObject[]> {
    if (depth > 2) return [];

    const sinceTs = sinceIso ? Math.floor(new Date(sinceIso).getTime() / 1000) : 0;
    const objects: DataObject[] = [];
    let pageToken: string | undefined;

    do {
      if (!canCallFeishu('doc_discovery')) break;

      const params: Record<string, string> = { page_size: '50' };
      if (pageToken) params['page_token'] = pageToken;
      if (parentToken) params['parent_node_token'] = parentToken;

      const resp = await feishuApi<FeishuListResp<FeishuWikiNode>>(
        `/wiki/v2/spaces/${spaceId}/nodes`,
        { params },
      );
      trackApiCall('feishu', 'doc_discovery');

      if (resp.code !== 0 || !resp.data?.items) break;

      for (const node of resp.data.items) {
        const nodeUpdatedTs = node.update_time ? parseInt(node.update_time) : 0;
        // 增量模式：跳过未变化的节点
        if (sinceTs > 0 && nodeUpdatedTs <= sinceTs) {
          // 即便自身没变，子节点可能变了，继续递归
          if (node.has_child) {
            const children = await this.discoverWikiNodes(spaceId, node.node_token, depth + 1, sinceIso);
            objects.push(...children);
          }
          continue;
        }

        const now = new Date().toISOString();
        const obj: DataObject = {
          object_id: `dm_feishu_wiki_${node.node_token}`,
          source: 'feishu',
          source_type: 'wiki',
          uri: `lark://wiki/${node.obj_token}`,
          external_url: `https://${process.env['FEISHU_TENANT_DOMAIN'] ?? 'your-org.feishu.cn'}/wiki/${node.node_token}`,
          title: node.title || '(untitled)',
          sensitivity: 'internal',
          acl: { read: ['role:all_staff'] },
          tags: ['wiki'],
          owner: node.creator,
          created_at: node.create_time
            ? new Date(parseInt(node.create_time) * 1000).toISOString()
            : now,
          updated_at: node.update_time
            ? new Date(parseInt(node.update_time) * 1000).toISOString()
            : now,
          last_indexed_at: now,
          ttl_seconds: TTL.wiki,
          connector_id: this.id,
          data_scope: 'group',
          metadata: { space_id: spaceId, node_token: node.node_token, obj_type: node.obj_type },
        };

        // 拉取全文内容并存到本地
        try {
          if (canCallFeishu('doc_fetch') && (node.obj_type === 'doc' || node.obj_type === 'docx' || node.obj_type === 'wiki')) {
            const content = await this.fetchDocContent(node.obj_token, node.obj_type);
            trackApiCall('feishu', 'doc_fetch');
            if (content && content.length > 0) {
              const contentPath = saveContent('feishu_doc', obj.object_id, content);
              obj.content_path = contentPath;
              obj.content_length = content.length;
              obj.summary = content.slice(0, 200).replace(/\n/g, ' ');
            }
          }
        } catch (err) {
          log.debug(`Failed to fetch content for wiki node ${node.node_token}`, err);
        }

        objects.push(obj);

        if (node.has_child) {
          const children = await this.discoverWikiNodes(spaceId, node.node_token, depth + 1, sinceIso);
          objects.push(...children);
        }
      }

      pageToken = resp.data.has_more ? resp.data.page_token : undefined;
    } while (pageToken);

    return objects;
  }

  /**
   * 根据 file_token 重新拉取元数据并 upsert（飞书 Webhook 触发）
   * 遍历已索引的 URI 找到匹配项，更新标题和 updated_at
   */
  async fetchAndUpsertByToken(fileToken: string): Promise<void> {
    try {
      // 尝试 docx API 获取元数据
      const meta = await feishuApi<{
        code: number; msg: string;
        data: { document: { document_id: string; title: string; revision_id: number; } };
      }>(`/docx/v1/documents/${fileToken}`, {});

      if (meta.code !== 0 || !meta.data?.document) {
        log.warn(`Could not fetch metadata for token: ${fileToken}`, meta.msg);
        return;
      }

      const doc = meta.data.document;
      const now = new Date().toISOString();

      // 更新已索引对象的 title
      for (const uriPrefix of ['lark://wiki/', 'lark://docx/', 'lark://doc/']) {
        const uri = `${uriPrefix}${fileToken}`;
        const existing = getObjectByUri(uri);
        if (existing) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { last_indexed_at: _lia, created_at: _ca, ...rest } = existing;
          upsertObject({
            ...rest,
            title: doc.title || existing.title,
            updated_at: now,
          });
          // 同时失效缓存
          cacheInvalidate(uri);
          log.info(`Metadata refreshed for ${uri}: "${doc.title}"`);
          return;
        }
      }

      log.debug(`No existing object for token: ${fileToken}, skipping upsert`);
    } catch (err) {
      log.error(`fetchAndUpsertByToken failed for ${fileToken}`, err);
    }
  }

  /** 拉取文档纯文本内容 */
  private async fetchDocContent(token: string, type: string): Promise<string> {
    // docx 类型使用 docx/v1 API
    const resp = await feishuApi<FeishuDocContent>(
      `/docx/v1/documents/${token}/raw_content`,
      { params: { lang: '0' } },
    );

    if (resp.code !== 0) {
      throw new Error(`Feishu doc fetch failed: ${resp.msg}`);
    }

    return resp.data.content;
  }

  /** 解析飞书 URI */
  private parseUri(uri: string): { type: string; token: string } | null {
    // lark://wiki/{token}  or  lark://doc/{token}  or  lark://docx/{token}
    const match = uri.match(/^lark:\/\/(wiki|doc|docx)\/(.+)$/);
    if (!match) return null;
    return { type: match[1], token: match[2] };
  }

  // ─── 飞书 URL 直接拉取 ───

  /**
   * 解析飞书 URL → { token, type }
   * 支持格式：
   *   https://xxx.feishu.cn/wiki/{nodeToken}
   *   https://xxx.feishu.cn/docx/{docToken}
   *   https://xxx.feishu.cn/docs/{docToken}
   *   https://xxx.feishu.cn/sheets/{sheetToken}
   */
  parseFeishuUrl(url: string): { token: string; type: 'wiki' | 'docx' | 'doc' } | null {
    try {
      const u = new URL(url);
      if (!u.hostname.endsWith('feishu.cn') && !u.hostname.endsWith('larksuite.com')) return null;

      const segments = u.pathname.split('/').filter(Boolean);
      // /wiki/{token}  /docx/{token}  /docs/{token}
      if (segments.length < 2) return null;

      const typeStr = segments[0];
      const token = segments[1].split('?')[0]; // 截掉 query string

      if (typeStr === 'wiki') return { token, type: 'wiki' };
      if (typeStr === 'docx') return { token, type: 'docx' };
      if (typeStr === 'docs' || typeStr === 'doc') return { token, type: 'doc' };

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 通过飞书 URL 直接拉取文档内容
   * wiki URL 里是 node_token，需先转 obj_token
   */
  async fetchByUrl(url: string): Promise<{ content: string; title: string; token: string }> {
    const parsed = this.parseFeishuUrl(url);
    if (!parsed) throw new Error(`无法解析飞书 URL: ${url}`);

    if (!canCallFeishu('doc_fetch')) {
      throw new Error('飞书 API 配额不足');
    }

    let objToken = parsed.token;
    let title = '';

    if (parsed.type === 'wiki') {
      // wiki URL 的 token 是 node_token，需转为 obj_token
      const nodeResp = await feishuApi<{
        code: number; msg: string;
        data: { node: { obj_token: string; obj_type: string; title: string } };
      }>('/wiki/v2/spaces/get_node', { params: { token: parsed.token } });
      trackApiCall('feishu', 'doc_fetch');

      if (nodeResp.code !== 0 || !nodeResp.data?.node) {
        throw new Error(`获取 Wiki 节点失败: ${nodeResp.msg}`);
      }
      objToken = nodeResp.data.node.obj_token;
      title = nodeResp.data.node.title;
    } else {
      // docx/doc URL 可直接获取元数据
      try {
        const meta = await feishuApi<{
          code: number; msg: string;
          data: { document: { title: string } };
        }>(`/docx/v1/documents/${parsed.token}`, {});
        if (meta.code === 0 && meta.data?.document) {
          title = meta.data.document.title;
        }
      } catch {
        // 元数据获取失败不影响内容拉取
      }
    }

    // 拉取文档内容
    const content = await this.fetchDocContent(objToken, parsed.type);
    trackApiCall('feishu', 'doc_fetch');

    // 存到本地文件
    const objectId = `dm_feishu_url_${objToken}`;
    try {
      const contentPath = saveContent('feishu_doc', objectId, content);
      // 注册为 objects 以便后续搜索
      upsertObject({
        object_id: objectId,
        source: 'feishu',
        source_type: parsed.type === 'wiki' ? 'wiki' : 'document',
        uri: `lark://${parsed.type}/${objToken}`,
        external_url: url,
        title: title || '(飞书文档)',
        sensitivity: 'internal',
        acl: { read: ['role:all_staff'] },
        tags: ['feishu_url'],
        owner: '',
        updated_at: new Date().toISOString(),
        ttl_seconds: TTL.document,
        connector_id: this.id,
        data_scope: 'group',
        content_path: contentPath,
        content_length: content.length,
      });
    } catch (err) {
      log.debug('Failed to save URL-fetched content', err);
    }

    return { content, title: title || '(飞书文档)', token: objToken };
  }
}

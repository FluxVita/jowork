/**
 * Google Docs Connector
 * Token 由 GoogleConnector 统一授权后存在 'google' key，此处直接读取。
 */

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import { getGoogleToken } from '../google/index.js';

const log = createLogger('google-docs-connector');
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DOCS_API = 'https://docs.googleapis.com/v1';
const CACHE_TTL_S = 600;

async function apiGet<T>(url: string, token: string): Promise<T> {
  const res = await httpRequest<T>(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export class GoogleDocsConnector implements Connector {
  readonly id = 'google_docs_v1';
  readonly source: DataSource = 'google_docs';

  async discover(userId = 'system'): Promise<DataObject[]> {
    let token: string;
    try { token = getGoogleToken(userId); } catch {
      log.warn('Google not connected, skipping Docs discovery');
      return [];
    }

    const objects: DataObject[] = [];
    try {
      // 只列出 Google Docs 文档（mimeType 过滤）
      interface DriveFile { id: string; name: string; modifiedTime: string }
      interface DriveListResp { files: DriveFile[] }
      const list = await apiGet<DriveListResp>(
        `${DRIVE_API}/files?pageSize=50&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&q=mimeType%3D%27application%2Fvnd.google-apps.document%27`,
        token,
      );

      for (const file of list.files) {
        const uri = `google-docs://documents/${file.id}`;
        const obj: Partial<DataObject> = {
          uri,
          source: 'google_docs',
          source_type: 'document',
          title: file.name,
          sensitivity: 'internal',
          tags: ['google-docs', 'document'],
          updated_at: file.modifiedTime,
          connector_id: this.id,
          acl: { read: ['role:all_staff'] },
        };
        await upsertObject(obj as DataObject);
        objects.push(obj as DataObject);
      }
    } catch (err) {
      log.error('Google Docs discovery failed', err);
    }
    return objects;
  }

  async fetch(uri: string, userContext: { user_id: string; role: Role }): Promise<{
    content: string; content_type: string; cached: boolean;
  }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const match = uri.match(/^google-docs:\/\/documents\/(.+)$/);
    if (!match) throw new Error(`Invalid Google Docs URI: ${uri}`);

    const [, docId] = match;
    const token = getGoogleToken(userContext.user_id);

    interface DocParagraph { elements?: { textRun?: { content?: string } }[] }
    interface DocBody { content?: { paragraph?: DocParagraph }[] }
    interface Doc { title?: string; body?: DocBody }
    const doc = await apiGet<Doc>(`${DOCS_API}/documents/${docId}`, token);

    // 提取纯文本
    const lines: string[] = [];
    if (doc.title) lines.push(`# ${doc.title}`);
    for (const block of doc.body?.content ?? []) {
      if (!block.paragraph) continue;
      const text = block.paragraph.elements
        ?.map(el => el.textRun?.content ?? '')
        .join('') ?? '';
      if (text.trim()) lines.push(text.trimEnd());
    }

    const content = lines.join('\n');
    cacheSet(uri, content, 'text/markdown', CACHE_TTL_S);
    return { content, content_type: 'text/markdown', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    try {
      const token = getGoogleToken();
      const t0 = Date.now();
      // 列一个文档验证 token 有效
      await apiGet(
        `${DRIVE_API}/files?pageSize=1&q=mimeType%3D%27application%2Fvnd.google-apps.document%27`,
        token,
      );
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latency_ms: -1, error: String(err) };
    }
  }
}

/**
 * Google Drive Connector
 * Token 由 GoogleConnector 统一授权后存在 'google' key，此处直接读取。
 */

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import { getGoogleToken } from '../google/index.js';

const log = createLogger('google-drive-connector');
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const CACHE_TTL_S = 600;

async function driveGet<T>(path: string, token: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? '?' + new URLSearchParams(params) : '';
  const res = await httpRequest<T>(`${DRIVE_API}${path}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export class GoogleDriveConnector implements Connector {
  readonly id = 'google_drive_v1';
  readonly source: DataSource = 'google_drive';

  async discover(userId = 'system'): Promise<DataObject[]> {
    let token: string;
    try { token = getGoogleToken(userId); } catch {
      log.warn('Google not connected, skipping Drive discovery');
      return [];
    }

    const objects: DataObject[] = [];
    try {
      interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink?: string }
      interface DriveListResp { files: DriveFile[] }
      const list = await driveGet<DriveListResp>('/files', token, {
        pageSize: '50',
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
        orderBy: 'modifiedTime desc',
      });

      for (const file of list.files) {
        const uri = `google-drive://files/${file.id}`;
        const obj: Partial<DataObject> = {
          uri,
          source: 'google_drive',
          source_type: 'document',
          title: file.name,
          sensitivity: 'internal',
          tags: ['google-drive', file.mimeType.split('.').pop() ?? 'file'],
          updated_at: file.modifiedTime,
          connector_id: this.id,
          acl: { read: ['role:all_staff'] },
        };
        await upsertObject(obj as DataObject);
        objects.push(obj as DataObject);
      }
    } catch (err) {
      log.error('Google Drive discovery failed', err);
    }
    return objects;
  }

  async fetch(uri: string, userContext: { user_id: string; role: Role }): Promise<{
    content: string; content_type: string; cached: boolean;
  }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const match = uri.match(/^google-drive:\/\/files\/(.+)$/);
    if (!match) throw new Error(`Invalid Google Drive URI: ${uri}`);

    const [, fileId] = match;
    const token = getGoogleToken(userContext.user_id);

    interface DriveFileMeta { name: string; mimeType: string; description?: string; modifiedTime: string }
    const meta = await driveGet<DriveFileMeta>(`/files/${fileId}`, token, {
      fields: 'name,mimeType,description,modifiedTime',
    });

    const content = [
      `# ${meta.name}`,
      `**Type:** ${meta.mimeType}`,
      `**Modified:** ${meta.modifiedTime}`,
      meta.description ? `\n${meta.description}` : '',
    ].filter(Boolean).join('\n');

    cacheSet(uri, content, 'text/markdown', CACHE_TTL_S);
    return { content, content_type: 'text/markdown', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    try {
      const token = getGoogleToken();
      const t0 = Date.now();
      await driveGet('/about', token, { fields: 'user' });
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latency_ms: -1, error: String(err) };
    }
  }
}

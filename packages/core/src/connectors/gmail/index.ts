/**
 * Gmail Connector
 * Token 由 GoogleConnector 统一授权后存在 'google' key，此处直接读取。
 */

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import { getGoogleToken } from '../google/index.js';

const log = createLogger('gmail-connector');
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const CACHE_TTL_S = 300;

async function gmailGet<T>(path: string, token: string): Promise<T> {
  const res = await httpRequest<T>(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export class GmailConnector implements Connector {
  readonly id = 'gmail_v1';
  readonly source: DataSource = 'email';

  async discover(userId = 'system'): Promise<DataObject[]> {
    let token: string;
    try { token = getGoogleToken(userId); } catch {
      log.warn('Google not connected, skipping Gmail discovery');
      return [];
    }

    const objects: DataObject[] = [];
    try {
      const list = await gmailGet<{ messages?: { id: string; threadId: string }[] }>(
        '/users/me/messages?maxResults=50&labelIds=INBOX', token,
      );
      for (const msg of list.messages ?? []) {
        const uri = `gmail://me/messages/${msg.id}`;
        const obj: Partial<DataObject> = {
          uri, source: 'email', source_type: 'email',
          title: `Gmail message ${msg.id}`,
          sensitivity: 'internal', tags: ['gmail', 'inbox'],
          connector_id: this.id, acl: { read: [`user:${userId}`] },
        };
        await upsertObject(obj as DataObject);
        objects.push(obj as DataObject);
      }
    } catch (err) { log.error('Gmail discovery failed', err); }
    return objects;
  }

  async fetch(uri: string, userContext: { user_id: string; role: Role }): Promise<{
    content: string; content_type: string; cached: boolean;
  }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const match = uri.match(/^gmail:\/\/me\/messages\/(.+)$/);
    if (!match) throw new Error(`Invalid Gmail URI: ${uri}`);

    const token = getGoogleToken(userContext.user_id);
    interface GmailMsg { id: string; snippet: string; payload?: { headers?: { name: string; value: string }[] } }
    const msg = await gmailGet<GmailMsg>(`/users/me/messages/${match[1]}?format=metadata`, token);
    const headers = msg.payload?.headers ?? [];
    const subject = headers.find(h => h.name === 'Subject')?.value ?? '(no subject)';
    const from = headers.find(h => h.name === 'From')?.value ?? '';
    const date = headers.find(h => h.name === 'Date')?.value ?? '';

    const content = `# ${subject}\n\n**From:** ${from}\n**Date:** ${date}\n\n${msg.snippet}`;
    cacheSet(uri, content, 'text/markdown', CACHE_TTL_S);
    return { content, content_type: 'text/markdown', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    try {
      const token = getGoogleToken();
      const t0 = Date.now();
      await gmailGet('/users/me/profile', token);
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) { return { ok: false, latency_ms: -1, error: String(err) }; }
  }
}

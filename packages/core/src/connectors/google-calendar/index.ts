/**
 * Google Calendar Connector
 * Token 由 GoogleConnector 统一授权后存在 'google' key，此处直接读取。
 */

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import { getGoogleToken } from '../google/index.js';

const log = createLogger('google-calendar-connector');
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const CACHE_TTL_S = 300;

async function gcalGet<T>(path: string, token: string): Promise<T> {
  const res = await httpRequest<T>(`${CALENDAR_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export class GoogleCalendarConnector implements Connector {
  readonly id = 'google_calendar_v1';
  readonly source: DataSource = 'google_calendar';

  async discover(userId = 'system'): Promise<DataObject[]> {
    let token: string;
    try { token = getGoogleToken(userId); } catch {
      log.warn('Google not connected, skipping Calendar discovery');
      return [];
    }

    const objects: DataObject[] = [];
    try {
      interface EventItem { id: string; summary?: string; updated?: string }
      interface EventResp { items?: EventItem[] }
      const data = await gcalGet<EventResp>(
        '/calendars/primary/events?maxResults=50&singleEvents=true&orderBy=updated',
        token,
      );

      for (const event of data.items ?? []) {
        const uri = `google-calendar://events/${event.id}`;
        const obj: Partial<DataObject> = {
          uri,
          source: 'google_calendar',
          source_type: 'calendar',
          title: event.summary || '(untitled event)',
          sensitivity: 'internal',
          tags: ['google-calendar', 'event'],
          updated_at: event.updated,
          connector_id: this.id,
          acl: { read: ['role:all_staff'] },
        };
        await upsertObject(obj as DataObject);
        objects.push(obj as DataObject);
      }
    } catch (err) {
      log.error('Google Calendar discovery failed', err);
    }

    return objects;
  }

  async fetch(uri: string, userContext: { user_id: string; role: Role }): Promise<{ content: string; content_type: string; cached: boolean }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const match = uri.match(/^google-calendar:\/\/events\/(.+)$/);
    if (!match) throw new Error(`Invalid Google Calendar URI: ${uri}`);

    const token = getGoogleToken(userContext.user_id);
    interface Event {
      id: string;
      summary?: string;
      description?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      htmlLink?: string;
    }
    const event = await gcalGet<Event>(`/calendars/primary/events/${match[1]}`, token);
    const content = [
      `# ${event.summary || '(untitled event)'}`,
      `**Start:** ${event.start?.dateTime || event.start?.date || ''}`,
      `**End:** ${event.end?.dateTime || event.end?.date || ''}`,
      event.htmlLink ? `**Link:** ${event.htmlLink}` : '',
      '',
      event.description || '',
    ].filter(Boolean).join('\n');

    cacheSet(uri, content, 'text/markdown', CACHE_TTL_S);
    return { content, content_type: 'text/markdown', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    try {
      const token = getGoogleToken();
      const t0 = Date.now();
      await gcalGet('/users/me/calendarList?maxResults=1', token);
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latency_ms: -1, error: String(err) };
    }
  }
}

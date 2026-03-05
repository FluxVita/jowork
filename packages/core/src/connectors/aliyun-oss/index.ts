/**
 * 阿里云 OSS Connector — 会话日志索引
 *
 * 目录结构（可通过 ALIYUN_OSS_PREFIX 环境变量配置前缀）：
 *   {prefix}/monitor/{user_uid}/{session_type}/{date}/{run_id}.json
 *
 * Discover：索引所有用户目录（每个用户一个 DataObject）
 * Fetch：下载并解析具体会话文件
 */

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { createLogger } from '../../utils/logger.js';

// ali-oss 是 CJS 模块
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const log = createLogger('aliyun-oss');

const PREFIX = process.env['ALIYUN_OSS_PREFIX'] ?? 'vida';
const MONITOR_PREFIX = `${PREFIX}/monitor/`;

// ─── OSS 客户端（懒初始化）───

let _client: OSSClient | null = null;

interface OSSClient {
  list(query: Record<string, unknown>, options?: Record<string, unknown>): Promise<{
    objects?: Array<{ name: string; size: number; lastModified: string }>;
    prefixes?: string[];
    nextMarker?: string;
    isTruncated?: boolean;
  }>;
  get(name: string): Promise<{ content: Buffer }>;
}

function getClient(): OSSClient {
  if (_client) return _client;
  const keyId = process.env['ALIYUN_OSS_ACCESS_KEY_ID'];
  const keySecret = process.env['ALIYUN_OSS_ACCESS_KEY_SECRET'];
  const bucket = process.env['ALIYUN_OSS_BUCKET'];
  const region = `oss-${process.env['ALIYUN_OSS_REGION'] ?? 'us-east-1'}`.replace(/^oss-oss-/, 'oss-');
  if (!keyId || !keySecret || !bucket) throw new Error('Aliyun OSS config missing');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OSSClass = require('ali-oss') as any;
  _client = new OSSClass({ region, accessKeyId: keyId, accessKeySecret: keySecret, bucket });
  return _client!;
}

// ─── 辅助函数 ───

/** 分页列出所有对象/前缀（自动处理 nextMarker） */
async function listAll(prefix: string, delimiter = '/'): Promise<{ objects: string[]; prefixes: string[] }> {
  const client = getClient();
  const objects: string[] = [];
  const prefixes: string[] = [];
  let marker: string | undefined;

  do {
    const res = await client.list({
      prefix,
      delimiter,
      'max-keys': 1000,
      ...(marker ? { marker } : {}),
    }, {});
    (res.objects ?? []).forEach(o => objects.push(o.name));
    (res.prefixes ?? []).forEach(p => prefixes.push(p));
    marker = res.isTruncated ? res.nextMarker : undefined;
  } while (marker);

  return { objects, prefixes };
}

/** 从路径解析 user_uid */
function uidFromPrefix(prefix: string): string {
  // vida/monitor/73494823034019840/  →  73494823034019840
  const parts = prefix.replace(MONITOR_PREFIX, '').split('/');
  return parts[0];
}

// ─── Connector ───

export class AliyunOSSConnector implements Connector {
  readonly id = 'aliyun_oss_v1';
  readonly source: DataSource = 'aliyun_oss' as DataSource;

  async discover(): Promise<DataObject[]> {
    if (!process.env['ALIYUN_OSS_ACCESS_KEY_ID']) {
      log.warn('Aliyun OSS not configured, skipping');
      return [];
    }

    try {
      const { prefixes: userPrefixes } = await listAll(MONITOR_PREFIX, '/');
      log.info(`Found ${userPrefixes.length} user directories in OSS`);

      const objects: DataObject[] = [];
      const now = new Date().toISOString();

      for (const prefix of userPrefixes) {
        const uid = uidFromPrefix(prefix);
        if (!uid || !/^\d+$/.test(uid)) continue;

        // 列出 session 类型子目录（快速，不下载文件）
        const { prefixes: typePrefixes } = await listAll(prefix, '/');
        const sessionTypes = typePrefixes.map(p => p.replace(prefix, '').replace(/\/$/, ''));

        const obj: DataObject = {
          object_id: `dm_oss_user_${uid}`,
          source: 'aliyun_oss' as DataSource,
          source_type: 'document',
          uri: `aliyun-oss://monitor/${uid}`,
          title: `用户 ${uid} 的会话日志`,
          summary: `User UID: ${uid}，包含 ${sessionTypes.join('/')} 等类型的 AI 会话记录`,
          sensitivity: 'restricted',
          acl: { read: ['role:owner', 'role:admin', 'role:member'] },
          tags: ['oss', 'session-log', ...sessionTypes],
          created_at: now,
          updated_at: now,
          last_indexed_at: now,
          ttl_seconds: 3600,
          connector_id: this.id,
          data_scope: 'personal',
          metadata: { user_uid: uid, session_types: sessionTypes },
        };

        objects.push(obj);
        upsertObject(obj);
      }

      log.info(`OSS discover complete: ${objects.length} user objects indexed`);
      return objects;
    } catch (err) {
      log.error('OSS discovery failed', err);
      return [];
    }
  }

  async fetch(
    uri: string,
    _userContext: { user_id: string; role: Role },
  ): Promise<{ content: string; content_type: string; cached: boolean }> {
    // URI 格式：
    //   aliyun-oss://monitor/{uid}                        — 用户概览
    //   aliyun-oss://monitor/{uid}/{type}/{date}           — 某天某类型的 session 列表
    //   aliyun-oss://session/{ossPath}                    — 具体文件内容
    const parsed = parseUri(uri);
    if (!parsed) throw new Error(`Invalid OSS URI: ${uri}`);

    if (parsed.type === 'user_overview') {
      const content = await this.fetchUserOverview(parsed.uid);
      return { content, content_type: 'text/markdown', cached: false };
    }

    if (parsed.type === 'date_sessions') {
      const content = await this.fetchDateSessions(parsed.uid, parsed.sessionType!, parsed.date!);
      return { content, content_type: 'text/markdown', cached: false };
    }

    if (parsed.type === 'session_file') {
      const content = await this.fetchSessionFile(parsed.ossPath!);
      return { content, content_type: 'text/markdown', cached: false };
    }

    throw new Error(`Unsupported OSS URI type: ${uri}`);
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      const client = getClient();
      await client.list({ prefix: MONITOR_PREFIX, 'max-keys': 1, delimiter: '/' }, {});
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return { ok: false, latency_ms: Date.now() - start, error: String(err) };
    }
  }

  // ─── 内部 fetch 实现 ───

  private async fetchUserOverview(uid: string): Promise<string> {
    const { prefixes: typePrefixes } = await listAll(`${MONITOR_PREFIX}${uid}/`, '/');
    let md = `# 用户 ${uid} 的 OSS 会话日志概览\n\n`;

    for (const typePrefix of typePrefixes) {
      const sessionType = typePrefix.replace(`${MONITOR_PREFIX}${uid}/`, '').replace(/\/$/, '');
      const { prefixes: datePrefixes } = await listAll(typePrefix, '/');
      const dates = datePrefixes.map(d => d.split('/').slice(-2)[0]).sort();
      md += `## ${sessionType}\n`;
      md += `- 日期范围：${dates[0] ?? '—'} ～ ${dates[dates.length - 1] ?? '—'}\n`;
      md += `- 天数：${dates.length}\n\n`;
    }
    return md;
  }

  private async fetchDateSessions(uid: string, sessionType: string, date: string): Promise<string> {
    const prefix = `${MONITOR_PREFIX}${uid}/${sessionType}/${date}/`;
    const { objects } = await listAll(prefix, '');
    let md = `# ${uid} / ${sessionType} / ${date} — 会话列表\n\n共 ${objects.length} 个会话\n\n`;
    for (const name of objects) {
      const fileName = name.split('/').pop() ?? name;
      md += `- \`aliyun-oss://session/${name}\` (${fileName})\n`;
    }
    return md;
  }

  private async fetchSessionFile(ossPath: string): Promise<string> {
    const client = getClient();
    const buf = await client.get(ossPath);
    const json = JSON.parse(buf.content.toString('utf-8')) as SessionFile;
    return formatSession(json, ossPath);
  }
}

// ─── URI 解析 ───

interface ParsedUri {
  type: 'user_overview' | 'date_sessions' | 'session_file';
  uid: string;
  sessionType?: string;
  date?: string;
  ossPath?: string;
}

function parseUri(uri: string): ParsedUri | null {
  // aliyun-oss://monitor/73494823034019840
  let m = uri.match(/^aliyun-oss:\/\/monitor\/(\d+)$/);
  if (m) return { type: 'user_overview', uid: m[1] };

  // aliyun-oss://monitor/73494823034019840/default/2026-02-20
  m = uri.match(/^aliyun-oss:\/\/monitor\/(\d+)\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/);
  if (m) return { type: 'date_sessions', uid: m[1], sessionType: m[2], date: m[3] };

  // aliyun-oss://session/vida/monitor/.../file.json
  m = uri.match(/^aliyun-oss:\/\/session\/(.+)$/);
  if (m) return { type: 'session_file', uid: '', ossPath: m[1] };

  return null;
}

// ─── Session 文件解析 ───

interface SessionFile {
  run_id: string;
  user_id: number;
  entrance: string;
  stop_reason?: string;
  model_loops?: Array<{
    contents?: Array<{
      role: string;
      vertex_content?: { parts?: Array<{ text?: string }> };
    }>;
    settings?: { agent_name?: string };
  }>;
}

function formatSession(json: SessionFile, path: string): string {
  const fileName = path.split('/').pop() ?? path;
  let md = `# 会话记录\n`;
  md += `- **文件**: ${fileName}\n`;
  md += `- **用户 ID**: ${json.user_id}\n`;
  md += `- **入口**: ${json.entrance}\n`;
  if (json.stop_reason) md += `- **结束原因**: ${json.stop_reason}\n`;
  md += '\n';

  if (!json.model_loops?.length) return md + '（无对话内容）';

  for (const loop of json.model_loops) {
    const agentName = loop.settings?.agent_name ?? 'unknown';
    md += `## Agent: ${agentName}\n\n`;

    for (const item of (loop.contents ?? [])) {
      const role = item.role === 'model' ? 'Jovida' : 'User/System';
      const parts = item.vertex_content?.parts ?? [];
      for (const part of parts) {
        if (!part.text?.trim()) continue;
        // 截断过长的 system prompt（不是用户发言）
        const text = item.role === 'user' && part.text.length > 3000
          ? part.text.slice(0, 3000) + '\n...[截断]'
          : part.text;
        md += `**${role}**: ${text}\n\n`;
      }
    }
  }

  return md;
}

// 导出客户端工具函数供 Agent 工具使用
export { getClient, listAll, MONITOR_PREFIX, uidFromPrefix, formatSession };
export type { SessionFile };

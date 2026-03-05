import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import type { Connector, DataObject, DataSource, Role, Sensitivity } from '../../types.js';
import { config } from '../../config.js';
import { cacheGet, cacheSet } from '../base.js';
import { upsertObject } from '../../datamap/objects.js';
import { saveContent, readContentByPath } from '../../datamap/content-store.js';
import { getCursor, setCursor } from '../sync-state.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('email-connector');

// ─── 邮件分类 ───

type EmailCategory = 'feedback' | 'complaint' | 'urgent' | 'notification' | 'other';

const CATEGORY_RULES: { category: EmailCategory; patterns: RegExp[] }[] = [
  {
    category: 'urgent',
    patterns: [
      /urgent|紧急|ASAP|立即|critical|严重|crash|崩溃|故障|down|宕机/i,
    ],
  },
  {
    category: 'complaint',
    patterns: [
      /complaint|投诉|不满|差评|refund|退款|取消订阅|unsubscribe|cancel|问题很严重/i,
    ],
  },
  {
    category: 'feedback',
    patterns: [
      /feedback|反馈|建议|suggestion|feature request|功能请求|希望|体验|improve|改进|评价|review/i,
    ],
  },
  {
    category: 'notification',
    patterns: [
      /noreply|no-reply|notification|通知|automated|自动|system|系统/i,
    ],
  },
];

function classifyEmail(subject: string, body: string, from: string): EmailCategory {
  const text = `${subject} ${body.slice(0, 500)} ${from}`;
  for (const rule of CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) return rule.category;
    }
  }
  return 'other';
}

function categoryToSensitivity(cat: EmailCategory): Sensitivity {
  if (cat === 'complaint' || cat === 'urgent') return 'restricted';
  return 'internal';
}

function categoryToSourceType(cat: EmailCategory): 'feedback' | 'complaint' {
  return cat === 'complaint' ? 'complaint' : 'feedback';
}

// ─── SLA 计算 ───

interface SLAInfo {
  sla_minutes: number;
  deadline: string;
  is_overdue: boolean;
}

function computeSLA(category: EmailCategory, receivedAt: Date): SLAInfo {
  const slaMap: Record<string, number> = {
    urgent: config.email.sla.urgent_minutes,
    complaint: config.email.sla.complaint_minutes,
    feedback: config.email.sla.feedback_minutes,
    notification: 0,
    other: 0,
  };

  const minutes = slaMap[category] || 0;
  if (minutes === 0) {
    return { sla_minutes: 0, deadline: '', is_overdue: false };
  }

  const deadline = new Date(receivedAt.getTime() + minutes * 60_000);
  return {
    sla_minutes: minutes,
    deadline: deadline.toISOString(),
    is_overdue: Date.now() > deadline.getTime(),
  };
}

// ─── IMAP 辅助 ───

interface ParsedEmail {
  uid: number;
  message_id: string;
  from: string;
  to: string;
  subject: string;
  date: Date;
  text: string;
  html: string;
  has_attachments: boolean;
  account_id: string;
}

function createImapClient(account: { host: string; port: number; user: string; pass: string; tls: boolean }): ImapFlow {
  return new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.tls,
    auth: { user: account.user, pass: account.pass },
    logger: false,
  });
}

function extractToField(mail: ParsedMail): string {
  if (!mail.to) return '';
  if (Array.isArray(mail.to)) {
    return mail.to.map((a: { text: string }) => a.text).join(', ');
  }
  return mail.to.text;
}

async function fetchRecentEmails(
  accountId: string,
  account: { host: string; port: number; user: string; pass: string; tls: boolean },
  sinceDate: Date,
  maxCount: number = 50,
  sinceUid: number = 0,
): Promise<ParsedEmail[]> {
  const client = createImapClient(account);
  const emails: ParsedEmail[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      let searchResult: number[] | false;

      if (sinceUid > 0) {
        // UID 增量模式：搜索 UID > sinceUid 的邮件
        searchResult = await client.search({ uid: `${sinceUid + 1}:*` }, { uid: true });
      } else {
        searchResult = await client.search({ since: sinceDate }, { uid: true });
      }

      if (!searchResult || searchResult.length === 0) {
        log.info(`[${accountId}] No new emails`);
        return [];
      }

      const targetUids = searchResult.slice(-maxCount);
      const uidRange = targetUids.join(',');

      for await (const msg of client.fetch(uidRange, {
        source: true,
        uid: true,
      })) {
        try {
          if (!msg.source) {
            log.warn(`[${accountId}] Empty source for uid=${msg.uid}`);
            continue;
          }

          const parsed: ParsedMail = await simpleParser(msg.source) as ParsedMail;
          emails.push({
            uid: msg.uid,
            message_id: parsed.messageId || `${accountId}_${msg.uid}`,
            from: parsed.from?.text || '',
            to: extractToField(parsed),
            subject: parsed.subject || '(no subject)',
            date: parsed.date || new Date(),
            text: parsed.text || '',
            html: typeof parsed.html === 'string' ? parsed.html : '',
            has_attachments: (parsed.attachments?.length ?? 0) > 0,
            account_id: accountId,
          });
        } catch (parseErr) {
          log.warn(`[${accountId}] Failed to parse email uid=${msg.uid}`, parseErr);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    log.error(`[${accountId}] IMAP connection failed`, err);
    try { await client.logout(); } catch { /* ignore */ }
    throw err;
  }

  return emails;
}

// ─── Email Connector ───

export class EmailConnector implements Connector {
  readonly id = 'email_v1';
  readonly source: DataSource = 'email';

  /** 发现邮件（基于 UID cursor 真正增量） */
  async discover(): Promise<DataObject[]> {
    const accounts = config.email.accounts;
    if (accounts.length === 0) {
      log.warn('No email accounts configured, skipping discovery');
      return [];
    }

    const objects: DataObject[] = [];

    for (const account of accounts) {
      // 读取该账号的上次最大 UID
      const cursorKey = `last_uid_${account.id}`;
      const lastUidStr = getCursor(this.id, cursorKey);
      const lastUid = lastUidStr ? parseInt(lastUidStr) : 0;

      // 无 cursor 时降级到 7 天窗口（首次全量）
      const sinceDate = lastUid === 0
        ? new Date(Date.now() - 7 * 86400_000)
        : new Date(0); // cursor 模式下不用日期过滤，用 UID 过滤

      try {
        log.info(`[${account.id}] Discovering emails (lastUid=${lastUid})`);

        const emails = await fetchRecentEmails(account.id, account, sinceDate, 50, lastUid);
        let maxUid = lastUid;

        for (const email of emails) {
          if (email.uid > maxUid) maxUid = email.uid;

          const category = classifyEmail(email.subject, email.text, email.from);
          const sla = computeSLA(category, email.date);
          const sensitivity = categoryToSensitivity(category);

          const obj: DataObject = {
            object_id: `dm_email_${account.id}_${email.uid}`,
            source: 'email',
            source_type: categoryToSourceType(category),
            uri: `email://${account.id}/${email.uid}`,
            title: email.subject,
            summary: email.text.slice(0, 200).replace(/\n/g, ' '),
            sensitivity,
            acl: sensitivity === 'restricted'
              ? { read: account.acl_roles.filter(r => r.includes('admin') || r.includes('owner') || r.includes('member')) }
              : { read: account.acl_roles },
            tags: [
              'email', category, account.id,
              email.has_attachments ? 'attachment' : '',
              sla.is_overdue ? 'sla_overdue' : '',
            ].filter(Boolean),
            owner: email.from,
            created_at: email.date.toISOString(),
            updated_at: email.date.toISOString(),
            last_indexed_at: new Date().toISOString(),
            ttl_seconds: 900,
            connector_id: this.id,
            data_scope: 'group',
            metadata: {
              message_id: email.message_id,
              from: email.from, to: email.to, category,
              sla_minutes: sla.sla_minutes, sla_deadline: sla.deadline, sla_overdue: sla.is_overdue,
              account_id: account.id, has_attachments: email.has_attachments,
            },
          };

          // 保存邮件正文到本地
          if (email.text) {
            try {
              const contentPath = saveContent('email', obj.object_id, email.text);
              obj.content_path = contentPath;
              obj.content_length = email.text.length;
            } catch { /* non-critical */ }
          }

          objects.push(obj);
        }

        // 更新 UID cursor
        if (maxUid > lastUid) {
          setCursor(this.id, cursorKey, String(maxUid));
        }

        log.info(`[${account.id}] ${emails.length} emails discovered`);
      } catch (err) {
        log.error(`[${account.id}] Discovery failed`, err);
      }
    }

    for (const obj of objects) {
      upsertObject(obj);
    }

    log.info(`Email discover complete: ${objects.length} objects indexed`);
    return objects;
  }

  /** 按需拉取邮件全文（本地文件优先） */
  async fetch(
    uri: string,
    _userContext: { user_id: string; role: Role },
  ): Promise<{ content: string; content_type: string; cached: boolean }> {
    // 优先查本地全文文件
    const parsed = this.parseUri(uri);
    if (parsed) {
      const objectId = `dm_email_${parsed.accountId}_${parsed.uid}`;
      const localContent = readContentByPath(`data/content/email/${objectId}.md`);
      if (localContent) {
        return { content: localContent, content_type: 'text/markdown', cached: true };
      }
    }

    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    if (!parsed) throw new Error(`Invalid email URI: ${uri}`);

    const account = config.email.accounts.find(a => a.id === parsed.accountId);
    if (!account) throw new Error(`Email account not found: ${parsed.accountId}`);

    const client = createImapClient(account);

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        const msg = await client.fetchOne(String(parsed.uid), {
          source: true,
          uid: true,
        });

        if (!msg || !msg.source) {
          throw new Error(`Email not found: uid=${parsed.uid}`);
        }

        const email: ParsedMail = await simpleParser(msg.source) as ParsedMail;
        const category = classifyEmail(
          email.subject || '',
          email.text || '',
          email.from?.text || '',
        );
        const sla = computeSLA(category, email.date || new Date());

        let md = `# ${email.subject || '(no subject)'}\n\n`;
        md += `**From**: ${email.from?.text || '(unknown)'}\n`;
        md += `**To**: ${extractToField(email)}\n`;
        md += `**Date**: ${email.date?.toISOString() || ''}\n`;
        md += `**Category**: ${category}\n`;
        if (sla.sla_minutes > 0) {
          md += `**SLA**: ${sla.sla_minutes}min (Deadline: ${sla.deadline}) ${sla.is_overdue ? '**OVERDUE**' : 'OK'}\n`;
        }
        if (email.attachments?.length) {
          md += `**Attachments**: ${email.attachments.map((a: { filename?: string }) => a.filename || 'unnamed').join(', ')}\n`;
        }
        md += `\n---\n\n`;
        md += email.text || '(empty body)';

        cacheSet(uri, md, 'text/markdown', 900);
        return { content: md, content_type: 'text/markdown', cached: false };
      } finally {
        lock.release();
      }
    } finally {
      try { await client.logout(); } catch { /* ignore */ }
    }
  }

  /** 健康检查（测试 IMAP 连接） */
  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const accounts = config.email.accounts;
    if (accounts.length === 0) {
      return { ok: false, latency_ms: 0, error: 'No email accounts configured' };
    }

    const account = accounts[0];
    const start = Date.now();
    const client = createImapClient(account);

    try {
      await client.connect();
      await client.logout();
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return { ok: false, latency_ms: Date.now() - start, error: String(err) };
    }
  }

  private parseUri(uri: string): { accountId: string; uid: number } | null {
    // accountId 支持字母、数字、下划线、短横线
    const match = uri.match(/^email:\/\/([A-Za-z0-9_-]+)\/(\d+)$/);
    if (!match) return null;
    return { accountId: match[1], uid: parseInt(match[2], 10) };
  }
}

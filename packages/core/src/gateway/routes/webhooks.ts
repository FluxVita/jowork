import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { cacheInvalidate } from '../../connectors/base.js';
import { getObjectByUri, upsertObject } from '../../datamap/objects.js';
import { findOrCreateByFeishu, deactivateUser, getUserByFeishuId } from '../../auth/users.js';
import { trackApiCall } from '../../quota/manager.js';
import { logAudit } from '../../audit/logger.js';
import { config } from '../../config.js';
import { feishuApi } from '../../connectors/feishu/auth.js';
import { FeishuConnector } from '../../connectors/feishu/index.js';
import { handleChatMessage } from '../../connectors/feishu/chat-sync.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('webhooks');

const router = Router();
// Feishu connector 单例（用于 webhook 触发的增量更新）
const feishuConnector = new FeishuConnector();

// ─── 签名验证工具 ───

/** 验证飞书 webhook 签名（Verification Token） */
function verifyFeishuToken(token: string): boolean {
  const expected = config.feishu.verification_token;
  if (!expected || !token) return false; // 安全默认：未配置或缺失均拒绝
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** 验证 GitLab webhook 签名（X-Gitlab-Token） */
function verifyGitLabToken(headerToken: string | undefined): boolean {
  const expected = config.gitlab.webhook_secret;
  if (!expected) return false; // 安全默认：未配置时拒绝
  if (!headerToken) return false;
  try {
    const a = Buffer.from(headerToken);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── 飞书事件订阅 ───

interface FeishuEvent {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
  };
  event: Record<string, unknown>;
}

interface FeishuChallenge {
  challenge: string;
  token: string;
  type: string;
}

/** POST /api/webhook/feishu — 飞书事件回调 */
router.post('/feishu', (req, res) => {
  const body = req.body;

  // 飞书验证请求（URL Verification）
  if (body.type === 'url_verification') {
    const challenge = body as FeishuChallenge;
    // 验证 token
    if (!verifyFeishuToken(challenge.token)) {
      log.warn('Feishu URL verification failed: token mismatch');
      res.status(403).json({ error: 'Invalid verification token' });
      return;
    }
    log.info('Feishu URL verification');
    res.json({ challenge: challenge.challenge });
    return;
  }

  // 事件处理 — 验证签名
  const event = body as FeishuEvent;
  if (!event.header?.token || !verifyFeishuToken(event.header.token)) {
    log.warn('Feishu event rejected: token mismatch', { event_id: event.header?.event_id });
    res.status(403).json({ error: 'Invalid event token' });
    return;
  }

  const eventType = event.header?.event_type;

  log.info(`Feishu event: ${eventType}`, { event_id: event.header?.event_id });

  // 异步处理，立即返回 200
  res.json({ code: 0 });

  // 事件分发
  handleFeishuEvent(eventType, event.event).catch(err => {
    log.error('Feishu event handling failed', err);
  });
});

async function handleFeishuEvent(eventType: string, eventData: Record<string, unknown>) {
  switch (eventType) {
    // 消息事件 → 完整入库到 chat_messages
    case 'im.message.receive_v1': {
      await handleChatMessage(eventData);
      trackApiCall('feishu', 'event_receive', 0);
      break;
    }

    // 文档变更
    case 'drive.file.edit_v1':
    case 'drive.file.title_updated_v1': {
      const fileToken = eventData['file_token'] as string;
      if (fileToken) {
        // 1. 失效本地缓存
        cacheInvalidate(`lark://wiki/${fileToken}`);
        cacheInvalidate(`lark://doc/${fileToken}`);
        cacheInvalidate(`lark://docx/${fileToken}`);
        log.info(`Cache invalidated for file: ${fileToken}`);
        // 2. 异步重新拉取元数据并 upsert（更新 title/updated_at）
        feishuConnector.fetchAndUpsertByToken(fileToken).catch(err =>
          log.warn(`Failed to refresh metadata for ${fileToken}`, err)
        );
      }
      break;
    }

    // 通讯录用户新增（入职）
    case 'contact.user.created_v3': {
      const userObj = eventData['object'] as Record<string, unknown> | undefined;
      if (userObj) {
        const openId = userObj['open_id'] as string;
        const name = userObj['name'] as string;
        const email = userObj['email'] as string | undefined;
        const department = (userObj['department_ids'] as string[] | undefined)?.[0];

        if (openId && name) {
          const user = findOrCreateByFeishu(openId, name, { email, department });
          log.info(`New employee auto-onboarded: ${name} (${openId}) → role: ${user.role}`);

          // 发送欢迎消息
          try {
            await feishuApi('/im/v1/messages', {
              method: 'POST',
              params: { receive_id_type: 'open_id' },
              body: {
                receive_id: openId,
                msg_type: 'interactive',
                content: JSON.stringify({
                  config: { wide_screen_mode: true },
                  header: {
                    title: { tag: 'plain_text', content: `欢迎加入 ${process.env['ORG_NAME'] ?? 'Jowork'}!` },
                    template: 'green',
                  },
                  elements: [
                    {
                      tag: 'markdown',
                      content: `Hi ${name}，欢迎加入团队！\n\n` +
                        `你的账号已自动创建，当前角色：**${user.role}**\n` +
                        `如需调整权限，请联系管理员。\n\n` +
                        `**快速开始：**\n` +
                        `- 在群聊中 @我 即可提问\n` +
                        `- 访问 看板 查看项目数据\n` +
                        `- 使用 klaude 终端开始开发`,
                    },
                  ],
                }),
              },
            });
            trackApiCall('feishu', 'bot_welcome');
          } catch (err) {
            log.error('Failed to send welcome message', err);
          }

          logAudit({
            actor_id: 'system',
            actor_role: 'owner',
            channel: 'webhook',
            action: 'admin',
            result: 'allowed',
            matched_rule: 'auto_onboarding',
          });
        }
      }
      break;
    }

    // 通讯录用户离职/删除
    case 'contact.user.deleted_v3': {
      const oldObj = eventData['old_object'] as Record<string, unknown> | undefined;
      const openId = oldObj?.['open_id'] as string | undefined;
      if (openId) {
        const user = getUserByFeishuId(openId);
        if (user) {
          deactivateUser(user.user_id);
          log.info(`Employee deactivated: ${user.name} (${openId})`);
          logAudit({
            actor_id: 'system',
            actor_role: 'owner',
            channel: 'webhook',
            action: 'admin',
            result: 'allowed',
            matched_rule: 'auto_offboarding',
          });
        }
      }
      break;
    }

    default:
      log.debug(`Unhandled feishu event: ${eventType}`);
  }
}

// ─── GitLab Webhook ───

interface GitLabWebhookPayload {
  object_kind: string;
  project: { id: number; name: string; path_with_namespace: string; web_url: string };
  object_attributes?: Record<string, unknown>;
  ref?: string;
  commits?: { id: string; message: string; author: { name: string } }[];
}

/** POST /api/webhook/gitlab — GitLab 事件回调 */
router.post('/gitlab', (req, res) => {
  // 验证 GitLab webhook token
  const gitlabToken = req.headers['x-gitlab-token'] as string | undefined;
  if (!verifyGitLabToken(gitlabToken)) {
    log.warn('GitLab webhook rejected: token mismatch');
    res.status(403).json({ error: 'Invalid webhook token' });
    return;
  }

  const payload = req.body as GitLabWebhookPayload;
  const eventType = req.headers['x-gitlab-event'] as string;

  log.info(`GitLab webhook: ${eventType}`, { project: payload.project?.name });

  // 立即返回 200
  res.json({ received: true });

  // 异步处理
  handleGitLabEvent(eventType, payload).catch(err => {
    log.error('GitLab webhook handling failed', err);
  });
});

async function handleGitLabEvent(eventType: string, payload: GitLabWebhookPayload) {
  const projectId = payload.project?.id;
  if (!projectId) return;

  const now = new Date().toISOString();

  switch (eventType) {
    case 'Push Hook': {
      // Push → 使仓库缓存失效
      cacheInvalidate(`gitlab://repo/${projectId}`);

      // 更新仓库的 updated_at
      const existing = getObjectByUri(`gitlab://repo/${projectId}`);
      if (existing) {
        upsertObject({
          ...existing,
          updated_at: now,
        });
      }

      log.info(`Push to ${payload.project.name}: ${payload.commits?.length ?? 0} commits`);
      break;
    }

    case 'Merge Request Hook': {
      const attrs = payload.object_attributes!;
      const iid = attrs['iid'] as number;
      const uri = `gitlab://mr/${projectId}/${iid}`;

      // 使缓存失效
      cacheInvalidate(uri);

      // 更新或创建 MR 对象
      upsertObject({
        source: 'gitlab',
        source_type: 'merge_request',
        uri,
        external_url: attrs['url'] as string,
        title: `[${payload.project.name}] MR !${iid}: ${attrs['title']}`,
        summary: (attrs['description'] as string)?.slice(0, 200),
        sensitivity: 'internal',
        acl: { read: ['role:member', 'role:admin', 'role:owner'] },
        tags: ['code', 'merge_request', attrs['state'] as string],
        owner: (attrs['author'] as Record<string, string>)?.username,
        updated_at: now,
        ttl_seconds: 900,
        connector_id: 'gitlab_v1',
        metadata: {
          gitlab_project_id: projectId,
          iid,
          state: attrs['state'],
          action: attrs['action'],
        },
      });

      log.info(`MR ${attrs['action']}: !${iid} in ${payload.project.name}`);
      break;
    }

    case 'Issue Hook': {
      const attrs = payload.object_attributes!;
      const iid = attrs['iid'] as number;
      const uri = `gitlab://issue/${projectId}/${iid}`;

      cacheInvalidate(uri);

      upsertObject({
        source: 'gitlab',
        source_type: 'issue',
        uri,
        external_url: attrs['url'] as string,
        title: `[${payload.project.name}] #${iid}: ${attrs['title']}`,
        summary: (attrs['description'] as string)?.slice(0, 200),
        sensitivity: 'internal',
        acl: { read: ['role:member', 'role:admin', 'role:owner'] },
        tags: ['issue', attrs['state'] as string],
        owner: (attrs['author'] as Record<string, string>)?.username,
        updated_at: now,
        ttl_seconds: 900,
        connector_id: 'gitlab_v1',
        metadata: {
          gitlab_project_id: projectId,
          iid,
          state: attrs['state'],
          action: attrs['action'],
        },
      });

      log.info(`Issue ${attrs['action']}: #${iid} in ${payload.project.name}`);
      break;
    }

    case 'Pipeline Hook': {
      const attrs = payload.object_attributes!;
      log.info(`Pipeline ${attrs['status']}: ${payload.project.name} (${attrs['ref']})`);
      break;
    }

    default:
      log.debug(`Unhandled GitLab event: ${eventType}`);
  }
}

export default router;

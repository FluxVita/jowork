import { startGateway } from './gateway/server.js';
import { registerConnector } from './connectors/registry.js';
import { getDb } from './datamap/db.js';
import { FeishuConnector } from './connectors/feishu/index.js';
import { GitLabConnector } from './connectors/gitlab/index.js';
import { LinearConnector } from './connectors/linear/index.js';
import { PostHogConnector } from './connectors/posthog/index.js';
import { FigmaConnector } from './connectors/figma/index.js';
import { EmailConnector } from './connectors/email/index.js';
import { AliyunOSSConnector } from './connectors/aliyun-oss/index.js';
import { GitHubConnector } from './connectors/github/index.js';
import { GmailConnector } from './connectors/gmail/index.js';
import { OutlookConnector } from './connectors/outlook/index.js';
import { SlackConnector } from './connectors/slack/index.js';
import { GoogleDriveConnector } from './connectors/google-drive/index.js';
import { cacheCleanup } from './connectors/base.js';
import { startFeishuWS } from './connectors/feishu/ws.js';
import { startScheduler, setTaskExecutor, listCronTasks, createCronTask } from './scheduler/index.js';
import { executeTask } from './scheduler/executor.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('main');

// 注册连接器
registerConnector(new FeishuConnector());
registerConnector(new GitLabConnector());
registerConnector(new LinearConnector());
registerConnector(new PostHogConnector());
registerConnector(new FigmaConnector());
registerConnector(new EmailConnector());
registerConnector(new AliyunOSSConnector());
registerConnector(new GitHubConnector());
registerConnector(new GmailConnector());
registerConnector(new OutlookConnector());
registerConnector(new SlackConnector());
registerConnector(new GoogleDriveConnector());

// 启动 Gateway
startGateway();

// 注意：Klaude 认证代理（8899）已解耦为独立进程，通过 `npm run klaude-auth` 单独启动

// 启动飞书 WebSocket 长链接
startFeishuWS().catch(err => {
  log.error('Feishu WS startup failed (will retry on next restart)', err);
});

// 注册任务执行器
setTaskExecutor(executeTask);

// 预置自动发现任务（首次启动时创建）
seedAutoDiscoverTasks();

// 启动调度器
startScheduler();

// 定期清理过期缓存（每30分钟）
setInterval(() => {
  try { cacheCleanup(); } catch (err) { log.error('Cache cleanup failed', err); }
}, 30 * 60 * 1000);

// 每日数据库维护：WAL checkpoint + 过期数据清理
function runDailyMaintenance() {
  try {
    const db = getDb();
    const cutoff90d  = new Date(Date.now() - 90  * 86400_000).toISOString();
    const cutoff180d = new Date(Date.now() - 180 * 86400_000).toISOString();

    // WAL 强制合并，防止 WAL 文件无限膨胀
    db.exec('PRAGMA wal_checkpoint(RESTART)');

    // audit_logs 保留 90 天
    const auditDel = db.prepare('DELETE FROM audit_logs WHERE timestamp < ?').run(cutoff90d);

    // model_costs 保留 180 天
    const costDel = db.prepare('DELETE FROM model_costs WHERE created_at < ?').run(cutoff180d);

    // chat_messages 保留 180 天
    let chatDel = { changes: 0 };
    try { chatDel = db.prepare('DELETE FROM chat_messages WHERE created_at < ?').run(cutoff180d); } catch { /* 表可能不存在 */ }

    // 回收碎片空间（仅在有实际删除时执行）
    const totalDel = auditDel.changes + costDel.changes + chatDel.changes;
    if (totalDel > 0) {
      db.exec('VACUUM');
      log.info(`Daily maintenance: deleted audit=${auditDel.changes} costs=${costDel.changes} chat=${chatDel.changes}, VACUUM done`);
    } else {
      log.info('Daily maintenance: WAL checkpoint done, no rows expired');
    }
  } catch (err) {
    log.error('Daily maintenance failed', err);
  }
}

// 启动后 1 分钟执行首次 WAL checkpoint，之后每 24 小时一次
setTimeout(() => runDailyMaintenance(), 60_000);
setInterval(() => runDailyMaintenance(), 24 * 60 * 60_000);

log.info('All connectors registered, executor bound, scheduler started');

/**
 * 预置自动发现 Cron 任务
 * 仅在数据库中没有 sync 类型任务时创建，避免重复
 */
function seedAutoDiscoverTasks() {
  const existing = listCronTasks();
  const hasSyncTasks = existing.some(t => t.action_type === 'sync');
  if (hasSyncTasks) {
    log.debug('Auto-discover tasks already exist, skipping seed');
    return;
  }

  const presets = [
    {
      name: '自动索引: GitLab (每3小时)',
      cron_expr: '0 */3 * * *',
      connector_id: 'gitlab_v1',
    },
    {
      name: '自动索引: Linear (每3小时)',
      cron_expr: '30 */3 * * *',
      connector_id: 'linear_v1',
    },
    {
      name: '自动索引: 飞书 (每4小时)',
      cron_expr: '0 */4 * * *',
      connector_id: 'feishu_v1',
    },
    {
      name: '自动索引: PostHog (每天 6:00)',
      cron_expr: '0 6 * * *',
      connector_id: 'posthog_v1',
    },
    {
      name: '自动索引: 邮箱 (每2小时)',
      cron_expr: '15 */2 * * *',
      connector_id: 'email_v1',
    },
    {
      name: '群消息同步: 飞书 (每3小时)',
      cron_expr: '45 */3 * * *',
      connector_id: 'feishu_chat',
    },
    {
      name: '组织架构同步: 飞书 (每6小时)',
      cron_expr: '0 */6 * * *',
      connector_id: 'feishu_org',
    },
  ];

  for (const p of presets) {
    createCronTask({
      name: p.name,
      cron_expr: p.cron_expr,
      action_type: 'sync',
      action_config: { connector_id: p.connector_id },
      created_by: 'system',
      approved: true,
      enabled: true,
    });
    log.info(`Seeded: ${p.name}`);
  }

  log.info(`Created ${presets.length} auto-discover cron tasks`);
}

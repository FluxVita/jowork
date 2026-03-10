/**
 * @jowork/app — Jowork 开源版应用入口
 *
 * Personal 模式：仅依赖 @jowork/core，无 Premium 功能。
 * - 使用本地认证（无需 Feishu OAuth）
 * - 注册通用 Connector：GitLab、Linear、Figma、Email
 * - 提供开源版 Web UI（包含基础终端能力）
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '@jowork/core/gateway/server.js';
import { registerConnector } from '@jowork/core/connectors/registry.js';
import { cacheCleanup } from '@jowork/core/connectors/base.js';
import { GitLabConnector } from '@jowork/core/connectors/gitlab/index.js';
import { LinearConnector } from '@jowork/core/connectors/linear/index.js';
import { FigmaConnector } from '@jowork/core/connectors/figma/index.js';
import { EmailConnector } from '@jowork/core/connectors/email/index.js';
import { githubConnector } from '@jowork/core/connectors/github/index.js';
import { notionConnector } from '@jowork/core/connectors/notion/index.js';
import { SlackConnector } from '@jowork/core/connectors/slack/index.js';
import { GoogleConnector } from '@jowork/core/connectors/google/index.js';
import { GoogleDriveConnector } from '@jowork/core/connectors/google-drive/index.js';
import { GmailConnector } from '@jowork/core/connectors/gmail/index.js';
import { GoogleDocsConnector } from '@jowork/core/connectors/google-docs/index.js';
import { OutlookConnector } from '@jowork/core/connectors/outlook/index.js';
import { JiraConnector } from '@jowork/core/connectors/jira/index.js';
import { ConfluenceConnector } from '@jowork/core/connectors/confluence/index.js';
import { DiscordConnector } from '@jowork/core/connectors/discord/index.js';
import { GoogleCalendarConnector } from '@jowork/core/connectors/google-calendar/index.js';
import { telegramChannel } from '@jowork/core/channels/telegram.js';
import { startScheduler, stopScheduler, setTaskExecutor, listCronTasks, createCronTask } from '@jowork/core/scheduler/index.js';
import { executeTask } from '@jowork/core/scheduler/executor.js';
import { startHeartbeat, stopHeartbeat } from '@jowork/core/scheduler/heartbeat.js';
import { runDailyMaintenance } from '@jowork/core/resilience/index.js';
import { initLicenseClient } from '@jowork/core/billing/license-client.js';
import { createLogger } from '@jowork/core/utils/logger.js';

const log = createLogger('jowork');

const __dirname = dirname(fileURLToPath(import.meta.url));
// Jowork-specific frontend (shell.html override) + fallback to root public/
const joworkPublicDir = resolve(__dirname, '../public');
const fallbackPublicDir = resolve(__dirname, '../../../public');

// 注册通用 Connector（社区版，无 Premium 专属连接器）
registerConnector(new GitLabConnector());
registerConnector(new LinearConnector());
registerConnector(new FigmaConnector());
registerConnector(new EmailConnector());
registerConnector(githubConnector);
registerConnector(notionConnector);
registerConnector(new SlackConnector());
registerConnector(new GoogleConnector());      // 统一 OAuth 入口（"Connect Google" 按钮）
registerConnector(new GoogleDriveConnector());
registerConnector(new GmailConnector());
registerConnector(new GoogleDocsConnector());
registerConnector(new OutlookConnector());
registerConnector(new JiraConnector());
registerConnector(new ConfluenceConnector());
registerConnector(new DiscordConnector());
registerConnector(new GoogleCalendarConnector());
log.info('Extended connector set registered (OAuth-first)');

// 条件初始化通用 Channel（有配置则启用，channel 路由集成在后续版本中完善）
if (process.env['TELEGRAM_BOT_TOKEN']) {
  void telegramChannel.initialize({ token: process.env['TELEGRAM_BOT_TOKEN'] }).then(() => {
    log.info('Telegram channel initialized (polling mode)');
  });
}

// 启动 Gateway（Jowork 版前端 + 回退到共享 public/）
const gatewayServer = startGateway({
  publicDir: joworkPublicDir,
  fallbackPublicDir,
});

// 注册任务执行器
setTaskExecutor(executeTask);

// 预置自动发现任务
seedCronTasks();

// 启动调度器
startScheduler();

// 启动心跳（30 分钟间隔，处理 wake 事件 + 健康检查）
startHeartbeat();

// 定期清理过期缓存（每30分钟）
setInterval(() => {
  try { cacheCleanup(); } catch (err) { log.error('Cache cleanup failed', err); }
}, 30 * 60 * 1000);

// 每日维护（WAL checkpoint + 过期数据清理）
setTimeout(() => runDailyMaintenance(), 60_000);
setInterval(() => runDailyMaintenance(), 24 * 60 * 60_000);

log.info('Jowork started (community edition)');

// 自托管 License 验证（有 JOWORK_LICENSE_KEY 时向 jowork.work 验证并缓存，无 key 则跳过）
void initLicenseClient();

let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.warn(`Received ${signal}, graceful shutdown started`);

  try { stopScheduler(); } catch (err) { log.error('stopScheduler failed', err); }
  try { stopHeartbeat(); } catch (err) { log.error('stopHeartbeat failed', err); }
  try { await telegramChannel.shutdown(); } catch (err) { log.error('telegram shutdown failed', err); }

  await new Promise<void>((resolve) => {
    gatewayServer.close((err) => {
      if (err) log.error('Gateway close failed', err);
      resolve();
    });
  });

  log.warn('Graceful shutdown finished');
  process.exit(0);
}

process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

/**
 * 预置 Cron 任务（仅通用 Connector，首次启动时创建）
 */
function seedCronTasks() {
  const existing = listCronTasks();
  if (existing.some(t => t.action_type === 'sync')) {
    log.debug('Cron tasks already exist, skipping seed');
    return;
  }

  const presets = [
    { name: 'Auto-index: GitLab (every 3h)', cron_expr: '0 */3 * * *', connector_id: 'gitlab_v1' },
    { name: 'Auto-index: Linear (every 3h)',  cron_expr: '30 */3 * * *', connector_id: 'linear_v1' },
    { name: 'Auto-index: Figma (every 6h)',   cron_expr: '0 */6 * * *', connector_id: 'figma_v1' },
    { name: 'Auto-index: Email (every 2h)',   cron_expr: '15 */2 * * *', connector_id: 'email_v1' },
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
  }

  log.info(`Seeded ${presets.length} cron tasks`);
}

/**
 * 数据看板 API
 * 提供聚合指标供 Web UI 展示
 * 默认需要认证，可通过 PUBLIC_DASHBOARD_ENABLED=true 显式开放
 */

import { Router } from 'express';
import { getDb } from '../../datamap/db.js';
import { config } from '../../config.js';
import { getAlertStatus } from '../../alerts/engine.js';
import { getSystemHealth, listBackups, getDegradeStatus } from '../../resilience/index.js';
import { listMirrors, getReposRoot } from '../../connectors/gitlab/repo-mirror.js';
import { createLogger } from '../../utils/logger.js';
import { authMiddleware } from '../middleware.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDirSizeMb } from '../../platform.js';

const log = createLogger('dashboard-api');
const router = Router();
const PUBLIC_DASHBOARD_ENABLED = process.env['PUBLIC_DASHBOARD_ENABLED'] === 'true';

if (!PUBLIC_DASHBOARD_ENABLED) {
  router.use(authMiddleware);
}

/** GET /api/dashboard/overview — 系统概览 */
router.get('/overview', (_req, res) => {
  const db = getDb();

  // 数据地图统计
  const totalObjects = (db.prepare('SELECT COUNT(*) as n FROM objects').get() as { n: number }).n;
  const bySource = db.prepare('SELECT source, COUNT(*) as n FROM objects GROUP BY source').all() as { source: string; n: number }[];
  const byType = db.prepare('SELECT source_type, COUNT(*) as n FROM objects GROUP BY source_type ORDER BY n DESC LIMIT 10').all() as { source_type: string; n: number }[];

  // 连接器健康状态（从内存获取）
  const connectorCount = bySource.length;

  // 最近索引的对象
  const recentObjects = db.prepare(`
    SELECT source, source_type, title, updated_at
    FROM objects ORDER BY last_indexed_at DESC LIMIT 10
  `).all() as { source: string; source_type: string; title: string; updated_at: string }[];

  // 群消息统计
  let chatStats = { total_messages: 0, total_chats: 0, latest_sync: '' };
  try {
    const msgCount = db.prepare('SELECT COUNT(*) as n FROM chat_messages').get() as { n: number };
    const chatCount = db.prepare('SELECT COUNT(DISTINCT chat_id) as n FROM chat_messages').get() as { n: number };
    const latest = db.prepare('SELECT MAX(synced_at) as t FROM chat_messages').get() as { t: string | null };
    chatStats = {
      total_messages: msgCount.n,
      total_chats: chatCount.n,
      latest_sync: latest.t || '',
    };
  } catch { /* chat_messages table may not exist yet */ }

  // 全文内容统计
  let fullTextCount = 0;
  try {
    fullTextCount = (db.prepare("SELECT COUNT(*) as n FROM objects WHERE content_path IS NOT NULL AND content_path != ''").get() as { n: number }).n;
  } catch { /* content_path column may not exist yet */ }

  // 存储统计
  const indexOnlyCount = totalObjects - fullTextCount;
  const mirrors = listMirrors();
  const codeMirrorCount = mirrors.length;

  const storageStats = {
    local_fulltext: fullTextCount,
    index_only: indexOnlyCount,
    code_mirror: codeMirrorCount,
  };

  // 按源统计存储分布
  let storageBySource: { source: string; total: number; local_count: number; total_content_bytes: number }[] = [];
  try {
    storageBySource = db.prepare(`
      SELECT source,
        COUNT(*) as total,
        SUM(CASE WHEN content_path IS NOT NULL AND content_path != '' THEN 1 ELSE 0 END) as local_count,
        SUM(COALESCE(content_length, 0)) as total_content_bytes
      FROM objects GROUP BY source
    `).all() as typeof storageBySource;
  } catch { /* columns may not exist */ }

  // 磁盘占用
  const contentDir = join(dirname(config.db_path), 'content');
  const reposDir = getReposRoot();
  const contentDirMb = getDirSizeMb(contentDir);
  const reposDirMb = getDirSizeMb(reposDir);

  const diskUsage = {
    content_dir_mb: contentDirMb,
    repos_dir_mb: reposDirMb,
    total_mb: Math.round((contentDirMb + reposDirMb) * 10) / 10,
  };

  res.json({
    total_objects: totalObjects,
    by_source: bySource,
    by_type: byType,
    connector_count: connectorCount,
    recent_objects: recentObjects,
    chat_stats: chatStats,
    full_text_count: fullTextCount,
    storage_stats: storageStats,
    storage_by_source: storageBySource,
    disk_usage: diskUsage,
    code_mirrors: mirrors.map(m => ({ projectId: m.projectId, sizeMb: m.sizeMb })),
    timestamp: new Date().toISOString(),
  });
});

/** GET /api/dashboard/linear — Linear 项目进度 */
router.get('/linear', (_req, res) => {
  const db = getDb();

  const projects = db.prepare(`
    SELECT title, json_extract(metadata_json, '$.state') as state, owner, updated_at
    FROM objects WHERE source = 'linear' AND source_type = 'project'
    ORDER BY updated_at DESC
  `).all() as { title: string; state: string; owner: string; updated_at: string }[];

  // Issue 统计
  const issuesByState = db.prepare(`
    SELECT json_extract(metadata_json, '$.state') as state, COUNT(*) as n
    FROM objects WHERE source = 'linear' AND source_type = 'issue'
    GROUP BY state ORDER BY n DESC
  `).all() as { state: string; n: number }[];

  const totalIssues = issuesByState.reduce((sum, i) => sum + i.n, 0);

  // 最近活跃的 Issue
  const recentIssues = db.prepare(`
    SELECT title, json_extract(metadata_json, '$.state') as state,
           json_extract(metadata_json, '$.identifier') as identifier,
           owner, updated_at
    FROM objects WHERE source = 'linear' AND source_type = 'issue'
    ORDER BY updated_at DESC LIMIT 15
  `).all() as { title: string; state: string; identifier: string; owner: string; updated_at: string }[];

  res.json({
    projects,
    issues: {
      total: totalIssues,
      by_state: issuesByState,
      recent: recentIssues,
    },
    timestamp: new Date().toISOString(),
  });
});

/** GET /api/dashboard/posthog — PostHog 数据概览 */
router.get('/posthog', (_req, res) => {
  const db = getDb();

  const dashboards = db.prepare(`
    SELECT title, json_extract(metadata_json, '$.pinned') as pinned, external_url, updated_at
    FROM objects WHERE source = 'posthog' AND source_type = 'dashboard'
    ORDER BY updated_at DESC
  `).all() as { title: string; pinned: number; external_url: string; updated_at: string }[];

  const insightsByType = db.prepare(`
    SELECT json_extract(metadata_json, '$.insight_type') as insight_type, COUNT(*) as n
    FROM objects WHERE source = 'posthog' AND source_type = 'insight'
    GROUP BY insight_type ORDER BY n DESC
  `).all() as { insight_type: string; n: number }[];

  const totalInsights = insightsByType.reduce((sum, i) => sum + i.n, 0);

  // 最近的 Insights
  const recentInsights = db.prepare(`
    SELECT title, json_extract(metadata_json, '$.insight_type') as insight_type,
           external_url, updated_at
    FROM objects WHERE source = 'posthog' AND source_type = 'insight'
    ORDER BY updated_at DESC LIMIT 15
  `).all() as { title: string; insight_type: string; external_url: string; updated_at: string }[];

  res.json({
    dashboards,
    insights: {
      total: totalInsights,
      by_type: insightsByType,
      recent: recentInsights,
    },
    timestamp: new Date().toISOString(),
  });
});

/** GET /api/dashboard/gitlab — GitLab 代码活动 */
router.get('/gitlab', (_req, res) => {
  const db = getDb();

  const repos = db.prepare(`
    SELECT title, external_url, updated_at
    FROM objects WHERE source = 'gitlab' AND source_type = 'repository'
    ORDER BY updated_at DESC
  `).all() as { title: string; external_url: string; updated_at: string }[];

  const mrsByState = db.prepare(`
    SELECT json_extract(metadata_json, '$.state') as state, COUNT(*) as n
    FROM objects WHERE source = 'gitlab' AND source_type = 'merge_request'
    GROUP BY state
  `).all() as { state: string; n: number }[];

  const recentMRs = db.prepare(`
    SELECT title, json_extract(metadata_json, '$.state') as state,
           owner, external_url, updated_at
    FROM objects WHERE source = 'gitlab' AND source_type = 'merge_request'
    ORDER BY updated_at DESC LIMIT 10
  `).all() as { title: string; state: string; owner: string; external_url: string; updated_at: string }[];

  res.json({
    repositories: repos,
    merge_requests: {
      by_state: mrsByState,
      recent: recentMRs,
    },
    timestamp: new Date().toISOString(),
  });
});

/** GET /api/dashboard/system — 系统健康 */
router.get('/system', (_req, res) => {
  const db = getDb();

  // Cron 任务统计
  let cronTasks: { total: number; enabled: number } = { total: 0, enabled: 0 };
  try {
    cronTasks = db.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled
      FROM cron_tasks
    `).get() as { total: number; enabled: number };
  } catch { /* table may not exist */ }

  // 模型成本 + token 用量
  let todayCost = 0;
  let todayTokensIn = 0;
  let todayTokensOut = 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) as cost,
             COALESCE(SUM(tokens_in), 0) as tokens_in,
             COALESCE(SUM(tokens_out), 0) as tokens_out
      FROM model_costs WHERE date = ?
    `).get(today) as { cost: number; tokens_in: number; tokens_out: number } | undefined;
    todayCost = row?.cost ?? 0;
    todayTokensIn = row?.tokens_in ?? 0;
    todayTokensOut = row?.tokens_out ?? 0;
  } catch { /* table may not exist */ }

  // 用户数
  let userCount = 0;
  try {
    userCount = (db.prepare('SELECT COUNT(*) as n FROM users WHERE is_active = 1').get() as { n: number })?.n ?? 0;
  } catch { /* */ }

  // 告警状态
  const alerts = getAlertStatus();

  // 灾备状态
  const backups = listBackups();
  const degraded = getDegradeStatus();

  res.json({
    uptime_seconds: Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    active_users: userCount,
    cron_tasks: cronTasks,
    today_model_cost_usd: todayCost,
    today_tokens_in: todayTokensIn,
    today_tokens_out: todayTokensOut,
    alerts,
    resilience: {
      backups: backups.slice(0, 5),
      degraded_connectors: degraded,
    },
    node_version: process.version,
    timestamp: new Date().toISOString(),
  });
});

/** GET /api/dashboard/health — 系统健康全景 */
router.get('/health', async (_req, res) => {
  const health = await getSystemHealth();
  res.json(health);
});

/** GET /api/dashboard/email — 邮件 SLA 概览 */
router.get('/email', (_req, res) => {
  const db = getDb();

  // 邮件按分类统计
  const byCategory = db.prepare(`
    SELECT json_extract(metadata_json, '$.category') as category, COUNT(*) as n
    FROM objects WHERE source = 'email'
    GROUP BY category ORDER BY n DESC
  `).all() as { category: string; n: number }[];

  const totalEmails = byCategory.reduce((sum, c) => sum + c.n, 0);

  // SLA 超时的邮件
  const overdueEmails = db.prepare(`
    SELECT object_id, title, owner,
           json_extract(metadata_json, '$.category') as category,
           json_extract(metadata_json, '$.sla_deadline') as sla_deadline,
           json_extract(metadata_json, '$.account_id') as account_id,
           created_at
    FROM objects
    WHERE source = 'email'
      AND json_extract(metadata_json, '$.sla_overdue') = 1
    ORDER BY created_at DESC
    LIMIT 20
  `).all() as {
    object_id: string; title: string; owner: string;
    category: string; sla_deadline: string; account_id: string;
    created_at: string;
  }[];

  // 最近邮件
  const recentEmails = db.prepare(`
    SELECT title, owner,
           json_extract(metadata_json, '$.category') as category,
           json_extract(metadata_json, '$.account_id') as account_id,
           json_extract(metadata_json, '$.sla_minutes') as sla_minutes,
           created_at
    FROM objects WHERE source = 'email'
    ORDER BY created_at DESC LIMIT 15
  `).all() as {
    title: string; owner: string; category: string;
    account_id: string; sla_minutes: number; created_at: string;
  }[];

  // 按账号统计
  const byAccount = db.prepare(`
    SELECT json_extract(metadata_json, '$.account_id') as account_id, COUNT(*) as n
    FROM objects WHERE source = 'email'
    GROUP BY account_id
  `).all() as { account_id: string; n: number }[];

  res.json({
    total: totalEmails,
    by_category: byCategory,
    by_account: byAccount,
    overdue: {
      count: overdueEmails.length,
      emails: overdueEmails,
    },
    recent: recentEmails,
    sla_config: {
      urgent_minutes: config.email.sla.urgent_minutes,
      complaint_minutes: config.email.sla.complaint_minutes,
      feedback_minutes: config.email.sla.feedback_minutes,
    },
    timestamp: new Date().toISOString(),
  });
});


export default router;

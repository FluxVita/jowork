import { getConnector, getConnectors } from '../connectors/registry.js';
import { syncChatMessages, downloadPendingAttachments } from '../connectors/feishu/chat-sync.js';
import { syncOrgStructure } from '../connectors/feishu/org-sync.js';
import { updateAllMirrors } from '../connectors/gitlab/repo-mirror.js';
import { createLogger } from '../utils/logger.js';
import { logAudit } from '../audit/logger.js';

const log = createLogger('task-executor');

interface CronTask {
  task_id: string;
  name: string;
  cron_expr: string;
  action_type: 'message' | 'report' | 'sync' | 'custom';
  action_config: {
    template?: string;
    target_channel?: string;
    target_user_id?: string;
    connector_id?: string;
    query?: string;
  };
  created_by: string;
}

/**
 * 通用任务执行器
 * 根据 action_type 分发到不同的处理逻辑
 */
export async function executeTask(task: CronTask): Promise<void> {
  switch (task.action_type) {
    case 'sync':
      await executeSyncTask(task);
      break;
    case 'message':
      log.info(`Message task "${task.name}" — 投递功能待接入飞书/Telegram Bot`);
      break;
    case 'report':
      log.info(`Report task "${task.name}" — 报告生成功能待接入 Model Router`);
      break;
    case 'custom':
      log.info(`Custom task "${task.name}" — 自定义执行逻辑待扩展`);
      break;
    default:
      log.warn(`Unknown action_type: ${task.action_type}`);
  }
}

/**
 * 执行数据同步任务
 * connector_id='all' 时刷新所有连接器，否则刷新指定连接器
 */
async function executeSyncTask(task: CronTask): Promise<void> {
  const connectorId = task.action_config.connector_id;

  if (connectorId === 'all') {
    // 刷新所有连接器（并发执行，加速 3-6x）
    const connectors = getConnectors();
    let totalDiscovered = 0;
    const results: string[] = [];

    const settled = await Promise.allSettled(
      connectors.map(async (connector) => {
        const objects = await connector.discover();
        log.info(`Auto-discover ${connector.id}: ${objects.length} objects`);
        return { id: connector.id, count: objects.length };
      })
    );

    for (const s of settled) {
      if (s.status === 'fulfilled') {
        totalDiscovered += s.value.count;
        results.push(`${s.value.id}: ${s.value.count} objects`);
      } else {
        results.push(`ERROR: ${String(s.reason)}`);
        log.error('Auto-discover connector failed', s.reason);
      }
    }

    logAudit({
      actor_id: 'system',
      actor_role: 'owner',
      channel: 'scheduler',
      action: 'auto_discover_all',
      result: 'allowed',
      matched_rule: task.task_id,
      response_sources: results,
    });

    log.info(`Auto-discover all complete: ${totalDiscovered} total objects from ${connectors.length} connectors`);
  } else if (connectorId) {
    // 飞书群消息同步特殊处理
    if (connectorId === 'feishu_chat') {
      try {
        const result = await syncChatMessages();
        log.info(`Chat sync complete: ${result.total} messages from ${result.groups} groups`);

        // 消息同步后顺带下载未下载的附件（每次最多50个）
        downloadPendingAttachments().then(n => {
          if (n > 0) log.info(`Attachment download complete: ${n} files`);
        }).catch(err => log.error('Attachment download failed', err));

        logAudit({
          actor_id: 'system',
          actor_role: 'owner',
          channel: 'scheduler',
          action: 'chat_sync',
          result: 'allowed',
          matched_rule: task.task_id,
          response_sources: [`${result.total} messages from ${result.groups} groups`],
        });
      } catch (err) {
        log.error('Chat sync task failed', err);
      }
      return;
    }

    // 飞书组织架构同步
    if (connectorId === 'feishu_org') {
      try {
        const result = await syncOrgStructure();
        log.info(`Org sync complete: ${result.synced} synced, ${result.deactivated} deactivated`);

        logAudit({
          actor_id: 'system',
          actor_role: 'owner',
          channel: 'scheduler',
          action: 'org_sync',
          result: 'allowed',
          matched_rule: task.task_id,
          response_sources: [`${result.synced} synced, ${result.deactivated} deactivated`],
        });
      } catch (err) {
        log.error('Org sync task failed', err);
      }
      return;
    }

    // 刷新指定连接器
    const connector = getConnector(connectorId);
    if (!connector) {
      log.warn(`Connector not found: ${connectorId}`);
      return;
    }

    try {
      const objects = await connector.discover();
      log.info(`Auto-discover ${connectorId}: ${objects.length} objects`);

      // GitLab 同步后追加代码镜像更新
      if (connectorId === 'gitlab_v1') {
        updateAllMirrors().catch(err => {
          log.warn('Mirror update after gitlab sync failed', String(err));
        });
      }

      logAudit({
        actor_id: 'system',
        actor_role: 'owner',
        channel: 'scheduler',
        action: 'auto_discover',
        result: 'allowed',
        matched_rule: task.task_id,
        response_sources: [`${connectorId}: ${objects.length} objects`],
      });
    } catch (err) {
      log.error(`Auto-discover ${connectorId} failed`, err);
    }
  } else {
    log.warn(`Sync task "${task.name}" missing connector_id`);
  }
}

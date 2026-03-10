/**
 * agent/tools/gateway.ts — Phase 2.10: Gateway Self-Management Tool (P3)
 *
 * Agent 可查看 gateway 状态和配置。
 * 不开放 config_apply（风险太大，保留人工操作）。
 */
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tool, ToolContext } from '../types.js';
import { config as gatewayConfig } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:gateway');

const startTime = Date.now();

export const gatewayTool: Tool = {
  name: 'gateway',
  description:
    'View gateway server status and configuration. Actions: "status" (uptime, database info, system metrics), "config" (current configuration with sensitive values redacted). This tool is read-only for safety.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'config'],
        description: 'Action to perform',
      },
    },
    required: ['action'],
  },

  async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const action = input['action'] as string;

    try {
      switch (action) {
        case 'status':
          return handleStatus();
        case 'config':
          return handleConfig();
        default:
          return `Unknown action: ${action}. Valid: status, config`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`gateway tool error: ${action}`, err);
      return `Error: ${msg}`;
    }
  },
};

function handleStatus(): string {
  const uptimeMs = Date.now() - startTime;
  const uptime = formatUptime(uptimeMs);

  // 数据库信息
  const dbPath = gatewayConfig.db_path;
  let dbSize = 'N/A';
  if (existsSync(dbPath)) {
    const stat = statSync(dbPath);
    dbSize = `${(stat.size / 1024 / 1024).toFixed(1)}MB`;
  }

  // 内存使用
  const mem = process.memoryUsage();
  const heapUsed = `${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`;
  const heapTotal = `${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`;
  const rss = `${(mem.rss / 1024 / 1024).toFixed(1)}MB`;

  // workspace 目录大小
  const workspacePath = resolve(process.cwd(), 'data', 'workspaces');
  let workspaceInfo = 'not created';
  if (existsSync(workspacePath)) {
    workspaceInfo = 'exists';
  }

  return [
    '## Gateway Status',
    '',
    `- **Uptime**: ${uptime}`,
    `- **Port**: ${gatewayConfig.port}`,
    `- **Node.js**: ${process.version}`,
    `- **Platform**: ${process.platform} ${process.arch}`,
    '',
    '### Database',
    `- Path: ${dbPath}`,
    `- Size: ${dbSize}`,
    '',
    '### Memory',
    `- RSS: ${rss}`,
    `- Heap: ${heapUsed} / ${heapTotal}`,
    '',
    '### Workspaces',
    `- Directory: ${workspacePath}`,
    `- Status: ${workspaceInfo}`,
    '',
    '### Agent Config',
    `- Token Budget: ${gatewayConfig.agent.tokenBudget.toLocaleString()}`,
    `- Timeout: ${gatewayConfig.agent.timeoutMs / 1000}s`,
    `- Max Sub-agent Depth: ${gatewayConfig.agent.subagentMaxDepth}`,
  ].join('\n');
}

function handleConfig(): string {
  // 返回脱敏后的配置
  const lines = [
    '## Gateway Configuration (redacted)',
    '',
    `- port: ${gatewayConfig.port}`,
    `- host: ${gatewayConfig.host}`,
    `- db_path: ${gatewayConfig.db_path}`,
    `- cache_dir: ${gatewayConfig.cache_dir}`,
    `- token_storage_key: ${gatewayConfig.token_storage_key}`,
    '',
    '### Agent',
    `- tokenBudget: ${gatewayConfig.agent.tokenBudget}`,
    `- timeoutMs: ${gatewayConfig.agent.timeoutMs}`,
    `- budgetWarnThreshold: ${gatewayConfig.agent.budgetWarnThreshold}`,
    `- budgetHardMin: ${gatewayConfig.agent.budgetHardMin}`,
    `- subagentMaxDepth: ${gatewayConfig.agent.subagentMaxDepth}`,
    `- subagentMaxConcurrent: ${gatewayConfig.agent.subagentMaxConcurrent}`,
    '',
    '### Cron',
    `- maxConcurrentRuns: ${gatewayConfig.cron.maxConcurrentRuns}`,
    `- sessionRetentionHours: ${gatewayConfig.cron.sessionRetentionHours}`,
    '',
    '### Integrations',
    `- feishu: ${gatewayConfig.feishu.app_id ? 'configured' : 'not configured'}`,
    `- gitlab: ${gatewayConfig.gitlab.token ? 'configured' : 'not configured'}`,
    `- posthog: ${gatewayConfig.posthog.api_key ? 'configured' : 'not configured'}`,
    `- braveSearch: ${gatewayConfig.braveSearchApiKey ? 'configured' : 'not configured'}`,
    `- firecrawl: ${gatewayConfig.firecrawlApiKey ? 'configured' : 'not configured'}`,
    `- hooksEnabled: ${gatewayConfig.hooksEnabled}`,
    `- memoryEmbeddingProvider: ${gatewayConfig.memoryEmbeddingProvider}`,
  ];

  return lines.join('\n');
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

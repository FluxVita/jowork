import type { Tool } from '../types.js';
import { listConnectors } from '../../connectors/registry.js';

export const listSourcesTool: Tool = {
  name: 'list_sources',
  description: '列出当前可用的数据源连接器。用于了解系统接入了哪些数据源。',
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },

  async execute(): Promise<string> {
    const connectors = listConnectors();
    if (connectors.length === 0) return '当前没有注册的数据源连接器。';

    const sourceNames: Record<string, string> = {
      feishu: '飞书（文档、Wiki）',
      gitlab: 'GitLab（代码仓库、MR、Issue）',
      github: 'GitHub（仓库、PR、Issue）',
      linear: 'Linear（项目管理、任务）',
      jira: 'Jira（项目管理、Issue）',
      posthog: 'PostHog（产品分析、看板）',
      figma: 'Figma（设计文件）',
      notion: 'Notion（页面、数据库）',
      confluence: 'Confluence（Wiki 文档）',
      slack: 'Slack（频道与消息）',
      discord: 'Discord（服务器与频道）',
      google_drive: 'Google Drive（文档与文件）',
      google_calendar: 'Google Calendar（日程事件）',
      email: '邮箱（IMAP 邮件）',
    };

    return '可用数据源：\n' + connectors.map(c =>
      `- ${c.source} (${c.id}): ${sourceNames[c.source] ?? c.source}`
    ).join('\n');
  },
};

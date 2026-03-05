import { getDb } from '../datamap/db.js';
import { registerService } from './registry.js';
import { createLogger } from '../utils/logger.js';
import type { Role, ServiceType, DataScope } from '../types.js';

const log = createLogger('svc-seed');

const ALL_EXCEPT_GUEST: Role[] = ['owner', 'admin', 'member'];
const ALL_ROLES: Role[] = [...ALL_EXCEPT_GUEST, 'guest'];

interface SeedDef {
  service_id: string;
  name: string;
  type: ServiceType;
  category: string;
  description: string;
  icon: string;
  default_roles: Role[];
  config?: Record<string, unknown>;
  sort_order: number;
  data_scope?: DataScope;
}

const SEED_SERVICES: SeedDef[] = [
  // ── 模型 ──
  {
    service_id: 'svc_klaude', name: 'Klaude (Claude Proxy)', type: 'model',
    category: 'AI 模型', description: 'Claude 代理模型，团队默认 AI',
    icon: '🤖', default_roles: ALL_EXCEPT_GUEST,
    config: { provider: 'klaude', model: 'haiku' }, sort_order: 10,
  },
  {
    service_id: 'svc_moonshot', name: 'Moonshot (Kimi)', type: 'model',
    category: 'AI 模型', description: 'Moonshot 模型，Klaude 降级备选',
    icon: '🌙', default_roles: ['owner', 'admin', 'member'],
    config: { provider: 'moonshot' }, sort_order: 11,
  },

  // ── 连接器 ──
  {
    service_id: 'svc_feishu', name: '飞书', type: 'connector',
    category: '数据源', description: '飞书文档、Wiki、日历等',
    icon: '🐦', default_roles: ALL_EXCEPT_GUEST,
    config: { connector_id: 'feishu_v1' }, sort_order: 20,
    data_scope: 'group',
  },
  {
    service_id: 'svc_gitlab', name: 'GitLab', type: 'connector',
    category: '数据源', description: '代码仓库、MR、Issue、Pipeline',
    icon: '🦊', default_roles: ['owner', 'admin', 'member'],
    config: { connector_id: 'gitlab_v1' }, sort_order: 21,
    data_scope: 'dev',
  },
  {
    service_id: 'svc_linear', name: 'Linear', type: 'connector',
    category: '数据源', description: '项目管理、Issue 追踪',
    icon: '📐', default_roles: ALL_EXCEPT_GUEST,
    config: { connector_id: 'linear_v1' }, sort_order: 22,
    data_scope: 'public',
  },
  {
    service_id: 'svc_posthog', name: 'PostHog', type: 'connector',
    category: '数据源', description: '产品分析、Dashboard、Insight',
    icon: '📊', default_roles: ALL_EXCEPT_GUEST,
    config: { connector_id: 'posthog_v1' }, sort_order: 23,
    data_scope: 'public',
  },
  {
    service_id: 'svc_figma', name: 'Figma', type: 'connector',
    category: '数据源', description: '设计文件、组件库',
    icon: '🎨', default_roles: ALL_EXCEPT_GUEST,
    config: { connector_id: 'figma_v1' }, sort_order: 24,
    data_scope: 'personal',
  },
  {
    service_id: 'svc_email', name: '邮箱', type: 'connector',
    category: '数据源', description: 'IMAP 邮箱连接',
    icon: '📧', default_roles: ALL_EXCEPT_GUEST,
    config: { connector_id: 'email_v1' }, sort_order: 25,
    data_scope: 'group',
  },

  // ── 工具 ──
  {
    service_id: 'svc_tool_search', name: '数据搜索', type: 'tool',
    category: 'Agent 工具', description: '搜索数据地图中的对象',
    icon: '🔍', default_roles: ALL_EXCEPT_GUEST,
    config: { tool_name: 'search_data' }, sort_order: 30,
  },
  {
    service_id: 'svc_tool_fetch', name: '内容拉取', type: 'tool',
    category: 'Agent 工具', description: '通过 URI 拉取数据对象原文',
    icon: '📥', default_roles: ['owner', 'admin', 'member'],
    config: { tool_name: 'fetch_content' }, sort_order: 31,
  },
  {
    service_id: 'svc_tool_sources', name: '数据源列表', type: 'tool',
    category: 'Agent 工具', description: '查看已接入的数据源',
    icon: '📋', default_roles: ALL_EXCEPT_GUEST,
    config: { tool_name: 'list_sources' }, sort_order: 32,
  },
  {
    service_id: 'svc_tool_query', name: '精确查询', type: 'tool',
    category: 'Agent 工具', description: '按数据源/类型/敏感级别精确查询',
    icon: '🎯', default_roles: ['owner', 'admin', 'member'],
    config: { tool_name: 'run_query' }, sort_order: 33,
  },

  // ── 页面 ──
  {
    service_id: 'svc_page_chat', name: 'AI 对话', type: 'page',
    category: '页面', description: 'AI 对话助手界面',
    icon: '💬', default_roles: ALL_EXCEPT_GUEST,
    config: { path: '/chat.html' }, sort_order: 40,
  },
  {
    service_id: 'svc_page_ai_services', name: 'AI 服务', type: 'page',
    category: '页面', description: 'AI 服务管理（Klaude 等）',
    icon: '⚡', default_roles: ALL_EXCEPT_GUEST,
    config: { path: '/ai-services.html' }, sort_order: 43,
  },
  {
    service_id: 'svc_page_admin', name: '管理后台', type: 'page',
    category: '页面', description: '系统管理后台',
    icon: '⚙️', default_roles: ['owner', 'admin'],
    config: { path: '/admin.html' }, sort_order: 41,
  },
  {
    service_id: 'svc_page_dashboard', name: '数据看板', type: 'page',
    category: '页面', description: '公共数据概览看板',
    icon: '📈', default_roles: ALL_ROLES,
    config: { path: '/index.html' }, sort_order: 42,
  },
];

/** 种子服务初始化（仅空表时执行） */
export function seedDefaultServices(): void {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as n FROM services').get() as { n: number };
  if (count.n > 0) return;

  for (const svc of SEED_SERVICES) {
    registerService(svc);
  }

  log.info(`Seeded ${SEED_SERVICES.length} default services`);
}

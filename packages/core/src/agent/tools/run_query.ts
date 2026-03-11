import type { Tool, ToolContext, StructuredResult } from '../types.js';
import { searchObjects } from '../../datamap/objects.js';
import { filterByAccess } from '../../policy/engine.js';
import { getUserById } from '../../auth/users.js';
import type { DataSource, Sensitivity, SourceType } from '../../types.js';

function doQuery(input: Record<string, unknown>, ctx: ToolContext) {
  const user = getUserById(ctx.user_id);
  if (!user) return null;
  const results = searchObjects({
    source: input['source'] as DataSource | undefined,
    source_type: input['source_type'] as SourceType | undefined,
    sensitivity: input['sensitivity'] as Sensitivity | undefined,
    tags: input['tags'] as string[] | undefined,
    limit: (input['limit'] as number) || 20,
  });
  return { user, accessible: filterByAccess(user, results) };
}

// 这些数据源有专用查询工具，run_query 不应处理
const REDIRECT_SOURCES: Record<string, string> = {
  posthog: 'query_posthog',
};

export const runQueryTool: Tool = {
  name: 'run_query',
  description: '查询本地数据索引（文档、MR、Issue 等已索引的对象）。不能查询 PostHog 行为数据 — 请用 query_posthog 代替。',
  input_schema: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '数据源（注意：PostHog 请用 query_posthog 工具）', enum: ['feishu', 'gitlab', 'github', 'linear', 'jira', 'figma', 'notion', 'confluence', 'slack', 'discord', 'google_drive', 'google_calendar', 'email'] },
      source_type: { type: 'string', description: '数据类型' },
      sensitivity: { type: 'string', description: '敏感级别过滤（一般不需要传，系统会自动按用户权限过滤）' },
      tags: { type: 'array', items: { type: 'string' }, description: '标签过滤' },
      limit: { type: 'number', description: '返回数量上限，默认 20' },
    },
    required: [],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    // 拦截错误的工具选择，引导到正确工具
    const source = input['source'] as string | undefined;
    if (source && REDIRECT_SOURCES[source]) {
      return `[tool_error] run_query 不支持查询 ${source}。请改用 ${REDIRECT_SOURCES[source]} 工具直接查询 ${source} API。`;
    }
    const result = doQuery(input, ctx);
    if (!result) return 'ERROR: 用户不存在';
    const { accessible } = result;
    if (accessible.length === 0) {
      // 连续空结果时提示可能需要的专用工具
      return '未找到符合条件的数据对象。提示：如需查询 PostHog 行为数据请用 query_posthog 工具（action=hogql），如需查询 AI 对话日志请用 query_oss_sessions 工具。';
    }
    return `共 ${accessible.length} 条结果：\n` + accessible.map(obj =>
      `- [${obj.source}/${obj.source_type}] ${obj.title} (URI: ${obj.uri}, 敏感级别: ${obj.sensitivity}, 更新: ${obj.updated_at?.slice(0, 10) ?? '未知'})`
    ).join('\n');
  },

  async executeStructured(input: Record<string, unknown>, ctx: ToolContext): Promise<{ text: string; structured: StructuredResult }> {
    const source = input['source'] as string | undefined;
    if (source && REDIRECT_SOURCES[source]) {
      const msg = `[tool_error] run_query 不支持查询 ${source}。请改用 ${REDIRECT_SOURCES[source]} 工具直接查询 ${source} API。`;
      return { text: msg, structured: { type: 'table', columns: [], rows: [], total: 0 } };
    }
    const result = doQuery(input, ctx);
    if (!result) return { text: 'ERROR: 用户不存在', structured: { type: 'table', columns: [], rows: [], total: 0 } };
    const { accessible } = result;

    const columns = ['来源', '类型', '标题', '敏感级别', '更新时间', 'URI'];
    const rows = accessible.map(obj => ({
      '来源': obj.source,
      '类型': obj.source_type,
      '标题': obj.title,
      '敏感级别': obj.sensitivity,
      '更新时间': obj.updated_at?.slice(0, 10) ?? '未知',
      'URI': obj.uri,
    }));
    const text = accessible.length === 0
      ? '未找到符合条件的数据对象。'
      : `共 ${accessible.length} 条结果：\n` + accessible.map(obj =>
          `- [${obj.source}/${obj.source_type}] ${obj.title} (URI: ${obj.uri}, 敏感级别: ${obj.sensitivity}, 更新: ${obj.updated_at?.slice(0, 10) ?? '未知'})`
        ).join('\n');

    return { text, structured: { type: 'table', columns, rows, total: rows.length } };
  },
};

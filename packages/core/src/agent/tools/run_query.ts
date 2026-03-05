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

export const runQueryTool: Tool = {
  name: 'run_query',
  description: '按精确条件查询数据地图。可组合数据源、类型、敏感级别、标签等条件。适合需要精确过滤的场景（如"列出所有 GitLab merge_request"）。',
  input_schema: {
    type: 'object',
    properties: {
      source: { type: 'string', description: '数据源', enum: ['feishu', 'gitlab', 'github', 'linear', 'jira', 'posthog', 'figma', 'notion', 'confluence', 'slack', 'discord', 'google_drive', 'google_calendar', 'email'] },
      source_type: { type: 'string', description: '数据类型' },
      sensitivity: { type: 'string', description: '敏感级别', enum: ['public', 'internal', 'restricted', 'secret'] },
      tags: { type: 'array', items: { type: 'string' }, description: '标签过滤' },
      limit: { type: 'number', description: '返回数量上限，默认 20' },
    },
    required: [],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const result = doQuery(input, ctx);
    if (!result) return 'ERROR: 用户不存在';
    const { accessible } = result;
    if (accessible.length === 0) return '未找到符合条件的数据对象。';
    return `共 ${accessible.length} 条结果：\n` + accessible.map(obj =>
      `- [${obj.source}/${obj.source_type}] ${obj.title} (URI: ${obj.uri}, 敏感级别: ${obj.sensitivity}, 更新: ${obj.updated_at?.slice(0, 10) ?? '未知'})`
    ).join('\n');
  },

  async executeStructured(input: Record<string, unknown>, ctx: ToolContext): Promise<{ text: string; structured: StructuredResult }> {
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

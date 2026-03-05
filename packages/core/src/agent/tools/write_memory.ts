/**
 * agent/tools/write_memory.ts
 * Agent 工具：保存信息到用户记忆库
 */
import type { Tool, ToolContext } from '../types.js';
import { createMemory, getMemoryByTitle, updateMemory } from '../../memory/user-memory.js';
import { scheduleEmbedding } from '../../memory/embedding.js';

export const writeMemoryTool: Tool = {
  name: 'write_memory',
  description: '保存重要信息到用户的个人记忆库。用于记住用户的偏好、关键决策、重要事实等。如果已有同标题记忆则更新内容。',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '记忆标题（简洁描述）' },
      content: { type: 'string', description: '记忆内容（详细信息）' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '标签（可选），如 ["偏好", "技术决策"]',
      },
    },
    required: ['title', 'content'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const title = (input['title'] as string)?.trim();
    const content = (input['content'] as string)?.trim();
    const tags = input['tags'] as string[] | undefined;

    if (!title || !content) return 'ERROR: title 和 content 不能为空';

    // 检查是否已有同标题记忆，有则更新（精确标题匹配，避免 LIKE 搜索漏掉同名记忆）
    const match = getMemoryByTitle(ctx.user_id, title);
    if (match) {
      updateMemory(match.memory_id, ctx.user_id, {
        content,
        tags: tags ?? match.tags,
      });
      // 异步更新 embedding（内容变化后重新计算）
      scheduleEmbedding(match.memory_id, `${title}\n\n${content}`);
      return `已更新记忆「${title}」`;
    }

    const created = createMemory({
      user_id: ctx.user_id,
      title,
      content,
      tags,
    });
    // 异步计算并存储新记忆的 embedding（不阻塞工具返回）
    scheduleEmbedding(created.memory_id, `${title}\n\n${content}`);

    return `已保存记忆「${title}」`;
  },
};

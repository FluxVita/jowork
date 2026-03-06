import { listUserMemories, touchMemory, semanticSearchMemories } from '../../memory/user-memory.js';
/** 查询记忆并返回记忆对象列表（供 execute 和 executeStructured 共用） */
async function fetchMemories(input, ctx) {
    const query = input['query'];
    const tags = input['tags'];
    const memories = query
        ? await semanticSearchMemories(ctx.user_id, query, 5)
        : listUserMemories({ user_id: ctx.user_id, tags, limit: 5 });
    for (const m of memories)
        touchMemory(m.memory_id);
    return { memories, query };
}
export const readMemoryTool = {
    name: 'read_memory',
    description: '搜索当前用户的个人记忆库（语义搜索）。记忆库包含用户保存的知识片段、偏好、重要信息等。使用向量相似度优先排序，返回最多 5 条最相关的记忆。',
    input_schema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: '搜索关键词，匹配记忆的标题和内容' },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: '按标签过滤（可选）',
            },
        },
        required: [],
    },
    async execute(input, ctx) {
        const { memories, query } = await fetchMemories(input, ctx);
        if (memories.length === 0) {
            return query ? `未找到关于「${query}」的相关记忆。` : '记忆库为空。';
        }
        return memories.map(m => [
            `### ${m.title}`,
            m.tags.length > 0 ? `标签：${m.tags.join(', ')}` : null,
            '',
            m.content,
            '',
        ].filter(l => l !== null).join('\n')).join('\n---\n');
    },
    async executeStructured(input, ctx) {
        const { memories, query } = await fetchMemories(input, ctx);
        const text = memories.length === 0
            ? (query ? `未找到关于「${query}」的相关记忆。` : '记忆库为空。')
            : memories.map(m => [
                `### ${m.title}`,
                m.tags.length > 0 ? `标签：${m.tags.join(', ')}` : null,
                '', m.content, '',
            ].filter(l => l !== null).join('\n')).join('\n---\n');
        const structured = {
            type: 'list',
            total: memories.length,
            items: memories.map(m => ({
                title: m.title,
                description: m.content.length > 200 ? m.content.slice(0, 200) + '…' : m.content,
                meta: m.tags.length > 0 ? m.tags.join(' · ') : undefined,
            })),
        };
        return { text, structured };
    },
};
//# sourceMappingURL=read_memory.js.map
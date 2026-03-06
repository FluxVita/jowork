import { searchObjects, searchChatMessages } from '../../datamap/objects.js';
import { filterByAccess } from '../../policy/engine.js';
import { getUserById } from '../../auth/users.js';
import { getUserGroups } from '../../services/feishu-groups.js';
/** 共用查询逻辑，避免 execute 和 executeStructured 重复两次 DB 查询 */
async function doSearch(input, ctx) {
    const user = getUserById(ctx.user_id);
    if (!user)
        return null;
    const query = input['query'];
    const includeChat = input['include_chat'] !== false;
    const limit = input['limit'] || 10;
    const results = searchObjects({
        query,
        source: input['source'],
        source_type: input['source_type'],
        limit,
    });
    const accessible = filterByAccess(user, results);
    let chatResults = [];
    if (query && includeChat) {
        const userGroups = getUserGroups(ctx.user_id);
        const allowedChatIds = userGroups.map(g => g.group_id);
        chatResults = searchChatMessages({ query, allowed_chat_ids: allowedChatIds, limit: Math.min(limit, 10) });
    }
    return { accessible, chatResults, query };
}
export const searchDataTool = {
    name: 'search_data',
    description: '搜索公司内部数据地图（含全文搜索）。可按关键词、数据源、类型搜索飞书文档、GitLab 代码、Linear 任务、PostHog 数据、邮件、群聊消息等。返回匹配的数据对象列表。',
    input_schema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: '搜索关键词（支持全文搜索）' },
            source: { type: 'string', description: '数据源过滤：feishu/gitlab/linear/posthog/figma/email', enum: ['feishu', 'gitlab', 'linear', 'posthog', 'figma', 'email'] },
            source_type: { type: 'string', description: '数据类型过滤：document/wiki/repository/merge_request/issue/project/dashboard/insight 等' },
            include_chat: { type: 'boolean', description: '是否同时搜索群聊消息，默认 true' },
            limit: { type: 'number', description: '返回数量上限，默认 10' },
        },
        required: [],
    },
    async execute(input, ctx) {
        const result = await doSearch(input, ctx);
        if (!result)
            return 'ERROR: 用户不存在';
        const { accessible, chatResults, query } = result;
        const parts = [];
        if (accessible.length > 0) {
            parts.push('## 数据对象');
            for (const obj of accessible) {
                const hasContent = obj.content_path ? ' [全文]' : '';
                parts.push(`- [${obj.source}/${obj.source_type}]${hasContent} ${obj.title}${obj.summary ? ' — ' + obj.summary.slice(0, 200) : ''} (URI: ${obj.uri}, 更新: ${obj.updated_at?.slice(0, 10) ?? '未知'})`);
            }
        }
        if (query && chatResults.length > 0) {
            parts.push('\n## 群聊消息');
            for (const msg of chatResults) {
                parts.push(`- [${msg.created_at?.slice(0, 10)}] ${msg.sender_name}: ${msg.content_text.slice(0, 300).replace(/\n/g, ' ')}`);
            }
        }
        if (parts.length === 0)
            return '未找到匹配的数据对象或群聊消息。';
        return parts.join('\n');
    },
    async executeStructured(input, ctx) {
        const result = await doSearch(input, ctx);
        if (!result)
            return { text: 'ERROR: 用户不存在', structured: { type: 'list', items: [], total: 0 } };
        const { accessible, chatResults, query } = result;
        // 结构化 items
        const items = accessible.map(obj => ({
            title: obj.title,
            meta: `[${obj.source}/${obj.source_type}]${obj.content_path ? ' [全文]' : ''}`,
            description: obj.summary?.slice(0, 200) ?? undefined,
            uri: obj.uri,
        }));
        if (query) {
            for (const msg of chatResults) {
                items.push({
                    title: `${msg.sender_name}: ${msg.content_text.slice(0, 100)}`,
                    meta: `[群聊消息] ${msg.created_at?.slice(0, 10) ?? ''}`,
                    description: msg.content_text.slice(0, 300).replace(/\n/g, ' '),
                });
            }
        }
        // 文本版（直接从已有结果构建，不二次查询）
        const parts = [];
        if (accessible.length > 0) {
            parts.push('## 数据对象');
            for (const obj of accessible) {
                parts.push(`- [${obj.source}/${obj.source_type}]${obj.content_path ? ' [全文]' : ''} ${obj.title}${obj.summary ? ' — ' + obj.summary.slice(0, 200) : ''} (URI: ${obj.uri})`);
            }
        }
        if (query && chatResults.length > 0) {
            parts.push('\n## 群聊消息');
            for (const msg of chatResults) {
                parts.push(`- [${msg.created_at?.slice(0, 10)}] ${msg.sender_name}: ${msg.content_text.slice(0, 300).replace(/\n/g, ' ')}`);
            }
        }
        const text = parts.length > 0 ? parts.join('\n') : '未找到匹配的数据对象或群聊消息。';
        return { text, structured: { type: 'list', items, total: items.length } };
    },
};
//# sourceMappingURL=search_data.js.map
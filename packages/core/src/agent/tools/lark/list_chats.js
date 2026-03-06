import { getLarkUserToken, TOKEN_MISSING_MSG, larkApiWithUserToken } from './auth.js';
export const larkListChatsTool = {
    name: 'lark_list_chats',
    description: '列出你加入的飞书群聊（包括群名称、chat_id、成员数量）。用于查找群 ID 以发送消息或搜索消息时使用。需要先完成飞书授权。',
    input_schema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: '按群名称过滤（可选），不填返回前 50 个群',
            },
            limit: {
                type: 'number',
                description: '返回数量上限，默认 20，最大 50',
            },
        },
        required: [],
    },
    async execute(input, ctx) {
        const userToken = getLarkUserToken(ctx.user_id);
        if (!userToken)
            return TOKEN_MISSING_MSG;
        const query = input['query']?.toLowerCase();
        const limit = Math.min(input['limit'] ?? 20, 50);
        try {
            const resp = await larkApiWithUserToken(userToken, '/im/v1/chats', { params: { page_size: '50' } });
            if (resp.code !== 0)
                return `获取群列表失败（code=${resp.code}）：${resp.msg}`;
            let chats = resp.data?.items ?? [];
            if (query) {
                chats = chats.filter(c => c.name?.toLowerCase().includes(query));
            }
            chats = chats.slice(0, limit);
            if (chats.length === 0)
                return query ? `未找到名称包含「${query}」的群聊。` : '暂无群聊数据。';
            return `共 ${chats.length} 个群聊：\n` + chats.map(c => `- ${c.name}（chat_id: ${c.chat_id}${c.member_count ? '，成员数: ' + c.member_count : ''}）`).join('\n');
        }
        catch (err) {
            return `获取群列表失败：${String(err)}`;
        }
    },
    async executeStructured(input, ctx) {
        const userToken = getLarkUserToken(ctx.user_id);
        if (!userToken)
            return { text: TOKEN_MISSING_MSG, structured: { type: 'list', items: [], total: 0 } };
        const query = input['query']?.toLowerCase();
        const limit = Math.min(input['limit'] ?? 20, 50);
        try {
            const resp = await larkApiWithUserToken(userToken, '/im/v1/chats', { params: { page_size: '50' } });
            if (resp.code !== 0)
                return { text: `获取群列表失败：${resp.msg}`, structured: { type: 'list', items: [], total: 0 } };
            let chats = resp.data?.items ?? [];
            if (query)
                chats = chats.filter(c => c.name?.toLowerCase().includes(query));
            chats = chats.slice(0, limit);
            const items = chats.map(c => ({
                title: c.name,
                meta: c.chat_id,
                description: c.member_count ? `${c.member_count} 人` : undefined,
            }));
            const text = chats.length === 0
                ? '暂无群聊数据。'
                : `共 ${chats.length} 个群聊：\n` + chats.map(c => `- ${c.name}（${c.chat_id}）`).join('\n');
            return { text, structured: { type: 'list', items, total: items.length } };
        }
        catch (err) {
            return { text: `获取群列表失败：${String(err)}`, structured: { type: 'list', items: [], total: 0 } };
        }
    },
};
//# sourceMappingURL=list_chats.js.map
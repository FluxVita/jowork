import { getLarkUserToken, TOKEN_MISSING_MSG, larkApiWithUserToken } from './auth.js';
export const larkSendMessageTool = {
    name: 'lark_send_message',
    description: '以你的身份发送飞书消息到群聊或某个用户。支持文本和富文本（Markdown 格式）。适合：通知团队成员、分享调研结果、发布公告等。需要先完成飞书授权。',
    input_schema: {
        type: 'object',
        properties: {
            receive_id: {
                type: 'string',
                description: '接收方 ID。群聊用 chat_id（如 oc_xxx），个人用 open_id（如 ou_xxx）',
            },
            receive_id_type: {
                type: 'string',
                enum: ['chat_id', 'open_id', 'user_id', 'email'],
                description: '接收方 ID 类型，默认 chat_id',
            },
            content: {
                type: 'string',
                description: '消息内容。纯文本直接写，Markdown 格式会自动转为富文本',
            },
            msg_type: {
                type: 'string',
                enum: ['text', 'post'],
                description: '消息类型：text（纯文本）/ post（富文本，支持标题+段落+加粗等）。默认 text',
            },
        },
        required: ['receive_id', 'content'],
    },
    async execute(input, ctx) {
        const userToken = getLarkUserToken(ctx.user_id);
        if (!userToken)
            return TOKEN_MISSING_MSG;
        const receiveId = input['receive_id']?.trim();
        const receiveIdType = input['receive_id_type'] ?? 'chat_id';
        const content = input['content']?.trim();
        const msgType = input['msg_type'] ?? 'text';
        if (!receiveId || !content)
            return 'ERROR: receive_id 和 content 不能为空';
        // 构建消息体
        let msgContent;
        if (msgType === 'post') {
            // 将内容简单解析为 post 富文本（标题 + 段落）
            const lines = content.split('\n').filter(Boolean);
            const title = lines[0] ?? '';
            const bodyLines = lines.slice(1).map(line => [{ tag: 'text', text: line }]);
            msgContent = JSON.stringify({
                zh_cn: {
                    title,
                    content: bodyLines.length > 0 ? bodyLines : [[{ tag: 'text', text: title }]],
                },
            });
        }
        else {
            msgContent = JSON.stringify({ text: content });
        }
        try {
            const resp = await larkApiWithUserToken(userToken, '/im/v1/messages', {
                method: 'POST',
                params: { receive_id_type: receiveIdType },
                body: {
                    receive_id: receiveId,
                    msg_type: msgType,
                    content: msgContent,
                },
            });
            if (resp.code !== 0) {
                return `发送失败（code=${resp.code}）：${resp.msg}`;
            }
            return `消息发送成功，message_id: ${resp.data?.message_id ?? '未知'}`;
        }
        catch (err) {
            return `发送失败：${String(err)}`;
        }
    },
};
//# sourceMappingURL=send_message.js.map
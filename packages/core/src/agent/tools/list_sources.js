import { listConnectors } from '../../connectors/registry.js';
export const listSourcesTool = {
    name: 'list_sources',
    description: '列出当前可用的数据源连接器。用于了解系统接入了哪些数据源。',
    input_schema: {
        type: 'object',
        properties: {},
        required: [],
    },
    async execute() {
        const connectors = listConnectors();
        if (connectors.length === 0)
            return '当前没有注册的数据源连接器。';
        const sourceNames = {
            feishu: '飞书（文档、Wiki）',
            gitlab: 'GitLab（代码仓库、MR、Issue）',
            linear: 'Linear（项目管理、任务）',
            posthog: 'PostHog（产品分析、看板）',
            figma: 'Figma（设计文件）',
            email: '邮箱（IMAP 邮件）',
        };
        return '可用数据源：\n' + connectors.map(c => `- ${c.source} (${c.id}): ${sourceNames[c.source] ?? c.source}`).join('\n');
    },
};
//# sourceMappingURL=list_sources.js.map
import type { Connector, DataObject, DataSource, Role } from '../../types.js';
export declare class FeishuConnector implements Connector {
    readonly id = "feishu_v1";
    readonly source: DataSource;
    /** 发现数据对象：遍历 wiki 空间和文档（支持增量） */
    discover(): Promise<DataObject[]>;
    /** 按需拉取文档内容（本地文件优先） */
    fetch(uri: string, _userContext: {
        user_id: string;
        role: Role;
    }): Promise<{
        content: string;
        content_type: string;
        cached: boolean;
    }>;
    /** 健康检查 */
    health(): Promise<{
        ok: boolean;
        latency_ms: number;
        error?: string;
    }>;
    /** 发现 Wiki 空间下的所有节点（支持增量过滤） */
    private discoverWikiSpaces;
    /** 递归发现 Wiki 空间下的节点（增量：只返回 update_time > cursor 的节点） */
    private discoverWikiNodes;
    /**
     * 根据 file_token 重新拉取元数据并 upsert（飞书 Webhook 触发）
     * 遍历已索引的 URI 找到匹配项，更新标题和 updated_at
     */
    fetchAndUpsertByToken(fileToken: string): Promise<void>;
    /** 拉取文档纯文本内容 */
    private fetchDocContent;
    /** 解析飞书 URI */
    private parseUri;
    /**
     * 解析飞书 URL → { token, type }
     * 支持格式：
     *   https://xxx.feishu.cn/wiki/{nodeToken}
     *   https://xxx.feishu.cn/docx/{docToken}
     *   https://xxx.feishu.cn/docs/{docToken}
     *   https://xxx.feishu.cn/sheets/{sheetToken}
     */
    parseFeishuUrl(url: string): {
        token: string;
        type: 'wiki' | 'docx' | 'doc';
    } | null;
    /**
     * 通过飞书 URL 直接拉取文档内容
     * wiki URL 里是 node_token，需先转 obj_token
     */
    fetchByUrl(url: string): Promise<{
        content: string;
        title: string;
        token: string;
    }>;
}
//# sourceMappingURL=index.d.ts.map
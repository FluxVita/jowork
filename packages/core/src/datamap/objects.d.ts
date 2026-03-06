import type { DataObject, Sensitivity, DataSource, SourceType, DataScope } from '../types.js';
export declare function upsertObject(obj: Omit<DataObject, 'object_id' | 'created_at' | 'last_indexed_at'> & {
    object_id?: string;
}): string;
export declare function searchObjects(opts: {
    query?: string;
    source?: DataSource;
    source_type?: SourceType;
    sensitivity?: Sensitivity;
    data_scope?: DataScope;
    tags?: string[];
    limit?: number;
    offset?: number;
}): DataObject[];
/** 搜索群聊消息（FTS5），支持按 allowed_chat_ids 权限过滤 */
export declare function searchChatMessages(opts: {
    query: string;
    chat_id?: string;
    allowed_chat_ids?: string[];
    limit?: number;
}): {
    message_id: string;
    chat_id: string;
    sender_name: string;
    content_text: string;
    created_at: string;
    msg_type: string;
}[];
export declare function getObject(objectId: string): DataObject | null;
export declare function getObjectByUri(uri: string): DataObject | null;
export declare function getStats(): {
    total: number;
    bySource: {
        source: string;
        n: number;
    }[];
    bySensitivity: {
        sensitivity: string;
        n: number;
    }[];
};
//# sourceMappingURL=objects.d.ts.map
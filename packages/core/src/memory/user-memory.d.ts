export interface UserMemory {
    memory_id: string;
    user_id: string;
    title: string;
    content: string;
    tags: string[];
    scope: 'personal' | 'team';
    pinned: boolean;
    last_used_at: string | null;
    created_at: string;
    updated_at: string;
}
export interface CreateMemoryInput {
    user_id: string;
    title: string;
    content: string;
    tags?: string[];
    scope?: 'personal' | 'team';
    pinned?: boolean;
}
export declare function createMemory(input: CreateMemoryInput): UserMemory;
export declare function getMemoryById(memory_id: string, user_id: string): UserMemory | null;
export declare function getMemoryByTitle(user_id: string, title: string): UserMemory | null;
export interface ListMemoriesOptions {
    user_id: string;
    query?: string;
    tags?: string[];
    scope?: 'personal' | 'team';
    pinned_only?: boolean;
    limit?: number;
    offset?: number;
}
export declare function listUserMemories(opts: ListMemoriesOptions): UserMemory[];
export interface UpdateMemoryInput {
    title?: string;
    content?: string;
    tags?: string[];
    scope?: 'personal' | 'team';
    pinned?: boolean;
}
export declare function updateMemory(memory_id: string, user_id: string, input: UpdateMemoryInput): UserMemory | null;
export declare function deleteMemory(memory_id: string, user_id: string): boolean;
/** 标记为最近使用（Agent 查询时调用） */
export declare function touchMemory(memory_id: string): void;
/**
 * 语义搜索记忆库。
 *
 * 优先用向量余弦相似度排序，对无 embedding 的记忆回退到关键词 LIKE 匹配。
 * 当 embedding API 不可用时，完全回退到关键词搜索。
 *
 * @param user_id 用户 ID
 * @param query   搜索查询文本
 * @param limit   返回条数上限
 */
export declare function semanticSearchMemories(user_id: string, query: string, limit?: number): Promise<UserMemory[]>;
//# sourceMappingURL=user-memory.d.ts.map
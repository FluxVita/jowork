import type { UserGroup } from '../types.js';
/** 同步全量群组映射 */
export declare function syncAllUserGroups(): Promise<{
    synced: number;
}>;
/** 同步单个用户的群组（登录时调用） */
export declare function syncUserGroups(userId: string, feishuOpenId: string): Promise<UserGroup[]>;
/** 查询用户所在群组 */
export declare function getUserGroups(userId: string): UserGroup[];
/** 查询所有已同步的群组（去重） */
export declare function listSyncedGroups(): {
    group_id: string;
    group_name: string;
    member_count: number;
}[];
//# sourceMappingURL=feishu-groups.d.ts.map
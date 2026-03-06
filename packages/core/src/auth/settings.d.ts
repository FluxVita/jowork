/** 设置用户配置 */
export declare function setUserSetting(userId: string, key: string, value: string): void;
/** 获取用户配置 */
export declare function getUserSetting(userId: string, key: string): string | null;
/** 列出用户所有配置（键名列表，不含值） */
export declare function listUserSettingKeys(userId: string): {
    key: string;
    updated_at: string;
}[];
/** 删除用户配置 */
export declare function deleteUserSetting(userId: string, key: string): void;
/** 可配置的系统级 key 白名单（渠道密钥已迁移到 channel-settings） */
declare const ALLOWED_KEYS: string[];
/** 验证 key 是否在白名单中 */
export declare function isAllowedKey(key: string): boolean;
export { ALLOWED_KEYS };
/** 写入指定 scope 的配置 */
export declare function setScopedValue(scope: 'org' | 'group' | 'user', scopeId: string, key: string, value: string): void;
/** 获取 org 级配置（系统调用，不需要 userId） */
export declare function getOrgSetting(key: string): string | null;
/** 三层查找：user → 所属 group → org（就近优先） */
export declare function getScopedValue(key: string, userId: string, groupIds?: string[]): {
    value: string;
    source: 'user' | 'group' | 'org';
} | null;
//# sourceMappingURL=settings.d.ts.map
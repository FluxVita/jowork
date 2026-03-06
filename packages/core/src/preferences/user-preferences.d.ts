export interface UserPreferences {
    language?: string;
    response_style?: 'concise' | 'balanced' | 'detailed';
    timezone?: string;
    default_channel?: 'feishu' | 'web';
    custom?: Record<string, unknown>;
}
declare const DEFAULTS: Required<Omit<UserPreferences, 'custom'>> & {
    custom: Record<string, unknown>;
};
/** 获取用户偏好（若不存在返回默认值） */
export declare function getUserPreferences(user_id: string): UserPreferences & typeof DEFAULTS;
/** 部分更新用户偏好 */
export declare function updateUserPreferences(user_id: string, patch: UserPreferences): UserPreferences;
/** 重置偏好到默认值 */
export declare function resetUserPreferences(user_id: string): UserPreferences;
/** 格式化为 Agent 系统提示注入片段 */
export declare function formatPrefsForPrompt(prefs: UserPreferences): string;
export {};
//# sourceMappingURL=user-preferences.d.ts.map
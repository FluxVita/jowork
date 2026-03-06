/** 获取用户的飞书 user_access_token（无效时返回 null） */
export declare function getLarkUserToken(userId: string): string | null;
/** 不可用时返回标准错误提示 */
export declare const TOKEN_MISSING_MSG = "\u98DE\u4E66\u64CD\u4F5C\u6743\u9650\u672A\u6388\u6743\u3002\u8BF7\u5728\u5BF9\u8BDD\u9875\u9762\u70B9\u51FB\"\u6388\u6743\u98DE\u4E66\"\u6309\u94AE\uFF0C\u901A\u8FC7\u98DE\u4E66 OAuth \u6388\u6743\u540E\u91CD\u8BD5\u3002";
/** 带用户 token 调用飞书 API */
export declare function larkApiWithUserToken<T = unknown>(userToken: string, path: string, opts?: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
}): Promise<{
    code: number;
    msg: string;
    data: T;
}>;
//# sourceMappingURL=auth.d.ts.map
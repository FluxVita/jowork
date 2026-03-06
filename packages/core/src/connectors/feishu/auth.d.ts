/** 获取飞书 tenant_access_token（自动缓存） */
export declare function getTenantToken(): Promise<string>;
/** 带认证头的飞书 API 请求 */
export declare function feishuApi<T = unknown>(path: string, opts?: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
}): Promise<T>;
//# sourceMappingURL=auth.d.ts.map
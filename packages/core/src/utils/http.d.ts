interface RequestOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
}
interface HttpResponse<T = unknown> {
    ok: boolean;
    status: number;
    data: T;
}
/** 通用 HTTP 请求工具 */
export declare function httpRequest<T = unknown>(url: string, opts?: RequestOptions): Promise<HttpResponse<T>>;
export {};
//# sourceMappingURL=http.d.ts.map
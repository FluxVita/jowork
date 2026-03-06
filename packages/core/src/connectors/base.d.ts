/** 加密缓存写入 */
export declare function cacheSet(uri: string, content: string, contentType: string, ttlSeconds: number): void;
/** 加密缓存读取 */
export declare function cacheGet(uri: string): {
    content: string;
    content_type: string;
} | null;
/** 使缓存失效 */
export declare function cacheInvalidate(uri: string): void;
/** 清理过期缓存（定期调用） */
export declare function cacheCleanup(): void;
//# sourceMappingURL=base.d.ts.map
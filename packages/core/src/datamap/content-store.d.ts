/** 保存全文内容到本地文件，返回文件路径 */
export declare function saveContent(source: string, objectId: string, content: string): string;
/** 读取本地全文内容 */
export declare function readContent(source: string, objectId: string): string | null;
/** 检查本地全文是否存在 */
export declare function contentExists(source: string, objectId: string): boolean;
/** 删除本地全文 */
export declare function deleteContent(source: string, objectId: string): void;
/** 获取内容文件大小（字节） */
export declare function contentSize(source: string, objectId: string): number;
/** 通过 content_path 直接读取文件 */
export declare function readContentByPath(contentPath: string): string | null;
/** 分段读取本地内容（按字符偏移） */
export declare function readContentRange(contentPath: string, offset?: number, limit?: number): {
    content: string;
    totalLength: number;
    hasMore: boolean;
} | null;
/** 获取内容文件总字符长度 */
export declare function getContentLength(contentPath: string): number;
//# sourceMappingURL=content-store.d.ts.map
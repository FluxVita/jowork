import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('content-store');
/** 全文内容本地文件存储 */
const CONTENT_ROOT = join(dirname(config.db_path), 'content');
/** 生成存储路径：data/content/{source}/{objectId}.md */
function contentPath(source, objectId) {
    // 清理非法字符
    const safeId = objectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(CONTENT_ROOT, source, `${safeId}.md`);
}
/** 保存全文内容到本地文件，返回文件路径 */
export function saveContent(source, objectId, content) {
    const path = contentPath(source, objectId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
    return path;
}
/** 读取本地全文内容 */
export function readContent(source, objectId) {
    const path = contentPath(source, objectId);
    if (!existsSync(path))
        return null;
    try {
        return readFileSync(path, 'utf-8');
    }
    catch (err) {
        log.warn(`Failed to read content: ${path}`, err);
        return null;
    }
}
/** 检查本地全文是否存在 */
export function contentExists(source, objectId) {
    return existsSync(contentPath(source, objectId));
}
/** 删除本地全文 */
export function deleteContent(source, objectId) {
    const path = contentPath(source, objectId);
    if (existsSync(path)) {
        unlinkSync(path);
    }
}
/** 获取内容文件大小（字节） */
export function contentSize(source, objectId) {
    const path = contentPath(source, objectId);
    if (!existsSync(path))
        return 0;
    try {
        return statSync(path).size;
    }
    catch {
        return 0;
    }
}
/** 通过 content_path 直接读取文件 */
export function readContentByPath(contentPath) {
    if (!contentPath || !existsSync(contentPath))
        return null;
    try {
        return readFileSync(contentPath, 'utf-8');
    }
    catch (err) {
        log.warn(`Failed to read content by path: ${contentPath}`, err);
        return null;
    }
}
/** 分段读取本地内容（按字符偏移） */
export function readContentRange(contentPath, offset = 0, limit = 30000) {
    if (!contentPath || !existsSync(contentPath))
        return null;
    try {
        const full = readFileSync(contentPath, 'utf-8');
        const totalLength = full.length;
        const content = full.slice(offset, offset + limit);
        const hasMore = offset + limit < totalLength;
        return { content, totalLength, hasMore };
    }
    catch (err) {
        log.warn(`Failed to read content range: ${contentPath}`, err);
        return null;
    }
}
/** 获取内容文件总字符长度 */
export function getContentLength(contentPath) {
    if (!contentPath || !existsSync(contentPath))
        return 0;
    try {
        return readFileSync(contentPath, 'utf-8').length;
    }
    catch {
        return 0;
    }
}
//# sourceMappingURL=content-store.js.map
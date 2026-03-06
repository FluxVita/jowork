import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('cache');
const ALGORITHM = 'aes-256-gcm';
// 从 JWT secret 派生加密密钥
const CACHE_KEY = createHash('sha256').update(config.jwt_secret).digest();
/** 加密缓存写入 */
export function cacheSet(uri, content, contentType, ttlSeconds) {
    mkdirSync(config.cache_dir, { recursive: true });
    const key = createHash('sha256').update(uri).digest('hex').slice(0, 16);
    const filePath = join(config.cache_dir, `${key}.enc`);
    const entry = {
        content,
        content_type: contentType,
        expires_at: Date.now() + ttlSeconds * 1000,
    };
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, CACHE_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(entry), 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // 格式: iv(16) + authTag(16) + encrypted
    writeFileSync(filePath, Buffer.concat([iv, authTag, encrypted]));
    log.debug('Cache set', { uri: uri.slice(0, 50), ttl: ttlSeconds });
}
/** 加密缓存读取 */
export function cacheGet(uri) {
    const key = createHash('sha256').update(uri).digest('hex').slice(0, 16);
    const filePath = join(config.cache_dir, `${key}.enc`);
    if (!existsSync(filePath))
        return null;
    try {
        const data = readFileSync(filePath);
        const iv = data.subarray(0, 16);
        const authTag = data.subarray(16, 32);
        const encrypted = data.subarray(32);
        const decipher = createDecipheriv(ALGORITHM, CACHE_KEY, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
        const entry = JSON.parse(decrypted);
        if (Date.now() > entry.expires_at) {
            unlinkSync(filePath);
            log.debug('Cache expired', uri.slice(0, 50));
            return null;
        }
        log.debug('Cache hit', uri.slice(0, 50));
        return { content: entry.content, content_type: entry.content_type };
    }
    catch {
        // 解密失败则删除损坏的缓存
        try {
            unlinkSync(filePath);
        }
        catch { /* ignore */ }
        return null;
    }
}
/** 使缓存失效 */
export function cacheInvalidate(uri) {
    const key = createHash('sha256').update(uri).digest('hex').slice(0, 16);
    const filePath = join(config.cache_dir, `${key}.enc`);
    try {
        unlinkSync(filePath);
    }
    catch { /* ignore */ }
}
/** 清理过期缓存（定期调用） */
export function cacheCleanup() {
    if (!existsSync(config.cache_dir))
        return;
    const files = readdirSync(config.cache_dir).filter(f => f.endsWith('.enc'));
    let cleaned = 0;
    for (const file of files) {
        const filePath = join(config.cache_dir, file);
        try {
            const stat = statSync(filePath);
            const data = readFileSync(filePath);
            const iv = data.subarray(0, 16);
            const authTag = data.subarray(16, 32);
            const encrypted = data.subarray(32);
            const decipher = createDecipheriv(ALGORITHM, CACHE_KEY, iv);
            decipher.setAuthTag(authTag);
            const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
            const entry = JSON.parse(decrypted);
            if (Date.now() > entry.expires_at) {
                unlinkSync(filePath);
                cleaned++;
            }
        }
        catch {
            // 损坏文件也清理
            try {
                unlinkSync(filePath);
                cleaned++;
            }
            catch { /* ignore */ }
        }
    }
    if (cleaned > 0)
        log.info(`Cache cleanup: removed ${cleaned} expired entries`);
}
//# sourceMappingURL=base.js.map
/**
 * 内存日志缓冲区
 * 由 logger.ts 写入，API 读取供前端展示。
 * 环形缓冲：最多保留 MAX_ENTRIES 条，超出自动丢弃最旧的。
 */
const MAX_ENTRIES = 1000;
let seq = 0;
const buffer = [];
export function pushLog(level, component, message) {
    buffer.push({ id: ++seq, ts: new Date().toISOString(), level, component, message });
    if (buffer.length > MAX_ENTRIES)
        buffer.shift();
}
export function getLogs(opts = {}) {
    const { level, q, limit = 300, after } = opts;
    let result = buffer;
    if (after !== undefined) {
        result = result.filter(e => e.id > after);
    }
    if (level && level !== 'all') {
        result = result.filter(e => e.level === level);
    }
    if (q) {
        const lq = q.toLowerCase();
        result = result.filter(e => e.message.toLowerCase().includes(lq) ||
            e.component.toLowerCase().includes(lq));
    }
    return result.slice(-limit);
}
//# sourceMappingURL=log-buffer.js.map
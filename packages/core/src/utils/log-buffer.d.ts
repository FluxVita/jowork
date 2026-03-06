/**
 * 内存日志缓冲区
 * 由 logger.ts 写入，API 读取供前端展示。
 * 环形缓冲：最多保留 MAX_ENTRIES 条，超出自动丢弃最旧的。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
    id: number;
    ts: string;
    level: LogLevel;
    component: string;
    message: string;
}
export declare function pushLog(level: LogLevel, component: string, message: string): void;
export interface GetLogsOpts {
    level?: string;
    q?: string;
    limit?: number;
    after?: number;
}
export declare function getLogs(opts?: GetLogsOpts): LogEntry[];
//# sourceMappingURL=log-buffer.d.ts.map
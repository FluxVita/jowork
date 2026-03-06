/**
 * 灾备与降级模块
 * - SQLite 数据库自动备份（每日）
 * - 连接器降级（health fail 自动标记降级）
 * - 权限策略本地快照（断网时使用缓存策略）
 * - Gateway 健康自检
 */
interface DegradeStatus {
    degraded: boolean;
    since: string;
    consecutive_failures: number;
    last_error: string;
}
/** 记录连接器健康失败 */
export declare function markConnectorFailure(connectorId: string, error: string): void;
/** 记录连接器恢复 */
export declare function markConnectorRecovery(connectorId: string): void;
/** 检查连接器是否降级 */
export declare function isConnectorDegraded(connectorId: string): boolean;
/** 获取所有降级状态 */
export declare function getDegradeStatus(): Record<string, DegradeStatus>;
/** 备份数据库 */
export declare function backupDatabase(): string;
/** 获取备份列表 */
export declare function listBackups(): {
    name: string;
    size_bytes: number;
    created_at: string;
}[];
interface PolicySnapshot {
    timestamp: string;
    users: Record<string, {
        role: string;
        is_active: boolean;
    }>;
}
/** 保存当前权限策略快照 */
export declare function savePolicySnapshot(users: {
    user_id: string;
    role: string;
    is_active: boolean;
}[]): void;
/** 加载策略快照（断网时使用） */
export declare function loadPolicySnapshot(): PolicySnapshot | null;
export interface SystemHealth {
    gateway: 'healthy' | 'degraded' | 'critical';
    connectors: {
        total: number;
        healthy: number;
        degraded: number;
    };
    database: {
        ok: boolean;
        size_bytes: number;
        last_backup: string | null;
    };
    memory_mb: number;
    uptime_seconds: number;
}
/** 全面健康自检 */
export declare function getSystemHealth(): Promise<SystemHealth>;
/** 运行日常维护（由 scheduler 每天调用一次） */
export declare function runDailyMaintenance(): void;
export {};
//# sourceMappingURL=index.d.ts.map
/**
 * 灾备与降级模块
 * - SQLite 数据库自动备份（每日）
 * - 连接器降级（health fail 自动标记降级）
 * - 权限策略本地快照（断网时使用缓存策略）
 * - Gateway 健康自检
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config.js';
import { getConnectors } from '../connectors/registry.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('resilience');
const BACKUP_DIR = resolve(config.db_path, '..', 'backups');
const POLICY_SNAPSHOT_PATH = resolve(config.db_path, '..', 'policy-snapshot.json');
const MAX_BACKUPS = 7; // 保留最近 7 天
const connectorDegradeMap = new Map();
/** 记录连接器健康失败 */
export function markConnectorFailure(connectorId, error) {
    const existing = connectorDegradeMap.get(connectorId);
    const failures = (existing?.consecutive_failures ?? 0) + 1;
    connectorDegradeMap.set(connectorId, {
        degraded: failures >= 3, // 连续 3 次失败标记降级
        since: existing?.since ?? new Date().toISOString(),
        consecutive_failures: failures,
        last_error: error,
    });
    if (failures >= 3) {
        log.warn(`Connector ${connectorId} degraded after ${failures} consecutive failures`);
    }
}
/** 记录连接器恢复 */
export function markConnectorRecovery(connectorId) {
    const existing = connectorDegradeMap.get(connectorId);
    if (existing?.degraded) {
        log.info(`Connector ${connectorId} recovered from degraded state`);
    }
    connectorDegradeMap.delete(connectorId);
}
/** 检查连接器是否降级 */
export function isConnectorDegraded(connectorId) {
    return connectorDegradeMap.get(connectorId)?.degraded ?? false;
}
/** 获取所有降级状态 */
export function getDegradeStatus() {
    const result = {};
    for (const [id, status] of connectorDegradeMap) {
        result[id] = status;
    }
    return result;
}
// ─── SQLite 备份 ───
/** 备份数据库 */
export function backupDatabase() {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = join(BACKUP_DIR, `datamap-${timestamp}.db`);
    copyFileSync(config.db_path, backupPath);
    log.info(`Database backed up to ${backupPath}`);
    // 清理旧备份
    cleanOldBackups();
    return backupPath;
}
/** 清理超过 MAX_BACKUPS 的旧备份 */
function cleanOldBackups() {
    if (!existsSync(BACKUP_DIR))
        return;
    const files = readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('datamap-') && f.endsWith('.db'))
        .map(f => ({
        name: f,
        path: join(BACKUP_DIR, f),
        mtime: statSync(join(BACKUP_DIR, f)).mtimeMs,
    }))
        .sort((a, b) => b.mtime - a.mtime);
    if (files.length > MAX_BACKUPS) {
        for (const file of files.slice(MAX_BACKUPS)) {
            try {
                unlinkSync(file.path);
                log.debug(`Removed old backup: ${file.name}`);
            }
            catch { /* ignore */ }
        }
    }
}
/** 获取备份列表 */
export function listBackups() {
    if (!existsSync(BACKUP_DIR))
        return [];
    return readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('datamap-') && f.endsWith('.db'))
        .map(f => {
        const stat = statSync(join(BACKUP_DIR, f));
        return {
            name: f,
            size_bytes: stat.size,
            created_at: stat.mtime.toISOString(),
        };
    })
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
/** 保存当前权限策略快照 */
export function savePolicySnapshot(users) {
    const snapshot = {
        timestamp: new Date().toISOString(),
        users: {},
    };
    for (const u of users) {
        snapshot.users[u.user_id] = { role: u.role, is_active: u.is_active };
    }
    mkdirSync(resolve(POLICY_SNAPSHOT_PATH, '..'), { recursive: true });
    writeFileSync(POLICY_SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
    log.info(`Policy snapshot saved (${users.length} users)`);
}
/** 加载策略快照（断网时使用） */
export function loadPolicySnapshot() {
    if (!existsSync(POLICY_SNAPSHOT_PATH))
        return null;
    try {
        const data = readFileSync(POLICY_SNAPSHOT_PATH, 'utf-8');
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
/** 全面健康自检 */
export async function getSystemHealth() {
    // 连接器状态
    const connectors = getConnectors();
    let healthyCount = 0;
    let degradedCount = 0;
    for (const connector of connectors) {
        if (isConnectorDegraded(connector.id)) {
            degradedCount++;
        }
        else {
            healthyCount++;
        }
    }
    // 数据库
    let dbOk = true;
    let dbSize = 0;
    try {
        const stat = statSync(config.db_path);
        dbSize = stat.size;
    }
    catch {
        dbOk = false;
    }
    const backups = listBackups();
    const lastBackup = backups.length > 0 ? backups[0].created_at : null;
    // 整体状态
    const degradedRatio = degradedCount / connectors.length;
    let gatewayStatus = 'healthy';
    if (degradedRatio >= 0.5 || !dbOk)
        gatewayStatus = 'critical';
    else if (degradedRatio > 0)
        gatewayStatus = 'degraded';
    return {
        gateway: gatewayStatus,
        connectors: {
            total: connectors.length,
            healthy: healthyCount,
            degraded: degradedCount,
        },
        database: {
            ok: dbOk,
            size_bytes: dbSize,
            last_backup: lastBackup,
        },
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        uptime_seconds: Math.round(process.uptime()),
    };
}
// ─── 定期维护 ───
/** 运行日常维护（由 scheduler 每天调用一次） */
export function runDailyMaintenance() {
    log.info('Running daily maintenance...');
    // 1. 备份数据库
    try {
        backupDatabase();
    }
    catch (err) {
        log.error('Database backup failed', err);
    }
    // 2. 清理过期降级标记（超过 24 小时自动清除，让系统重试）
    const oneDayAgo = Date.now() - 86400_000;
    for (const [id, status] of connectorDegradeMap) {
        if (new Date(status.since).getTime() < oneDayAgo) {
            log.info(`Clearing stale degrade status for ${id}`);
            connectorDegradeMap.delete(id);
        }
    }
}
//# sourceMappingURL=index.js.map
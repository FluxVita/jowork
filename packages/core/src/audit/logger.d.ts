import type { AuditEntry } from '../types.js';
export declare function logAudit(entry: Omit<AuditEntry, 'audit_id' | 'timestamp'>): string;
export declare function queryAuditLogs(opts: {
    actor_id?: string;
    action?: string;
    from?: string;
    to?: string;
    limit?: number;
}): AuditEntry[];
//# sourceMappingURL=logger.d.ts.map
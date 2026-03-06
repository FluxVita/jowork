import type { DataSource } from '../types.js';
/** 记录一次 API 调用 */
export declare function trackApiCall(source: DataSource, category: string, count?: number): void;
/** 获取飞书当月已使用量 */
export declare function getFeishuMonthlyUsage(): {
    used: number;
    limit: number;
    ratio: number;
    alert_level: 'ok' | 'warning' | 'degraded' | 'critical' | 'exhausted';
};
/** 获取配额看板数据 */
export declare function getQuotaDashboard(): {
    today: {
        source: string;
        total: number;
    }[];
    feishu_monthly: {
        used: number;
        limit: number;
        ratio: number;
        alert_level: "ok" | "warning" | "degraded" | "critical" | "exhausted";
    };
};
/** 检查是否允许调用（配额保护） */
export declare function canCallFeishu(category: string): boolean;
//# sourceMappingURL=manager.d.ts.map
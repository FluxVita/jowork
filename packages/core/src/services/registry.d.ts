import type { Service, ServiceType, ServiceStatus, Role, DataScope } from '../types.js';
/** 注册新服务 */
export declare function registerService(svc: {
    service_id: string;
    name: string;
    type: ServiceType;
    category?: string;
    description?: string;
    endpoint?: string;
    config?: Record<string, unknown>;
    status?: ServiceStatus;
    icon?: string;
    default_roles?: Role[];
    requires_config?: boolean;
    sort_order?: number;
    data_scope?: DataScope;
}): Service;
/** 获取单个服务 */
export declare function getService(id: string): Service | null;
/** 列出服务（支持过滤） */
export declare function listServices(opts?: {
    type?: ServiceType;
    status?: ServiceStatus;
    data_scope?: DataScope;
}): Service[];
/** 更新服务字段 */
export declare function updateService(id: string, fields: Partial<{
    name: string;
    description: string;
    category: string;
    endpoint: string;
    config: Record<string, unknown>;
    icon: string;
    default_roles: Role[];
    requires_config: boolean;
    sort_order: number;
    data_scope: DataScope;
}>): void;
/** 更新服务状态 */
export declare function updateServiceStatus(id: string, status: ServiceStatus): void;
//# sourceMappingURL=registry.d.ts.map
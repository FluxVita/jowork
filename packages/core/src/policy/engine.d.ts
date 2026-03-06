import type { Sensitivity, AccessLevel, DataObject, User } from '../types.js';
/** 默认拒绝：检查用户对某数据对象的访问权限 */
export declare function checkAccess(user: User, object: DataObject, action: string): {
    allowed: boolean;
    level: AccessLevel;
    matched_rule?: string;
};
/** 按权限过滤对象列表（不可见的对象直接移除） */
export declare function filterByAccess(user: User, objects: DataObject[]): DataObject[];
/** 检查是否允许本地下沉 */
export declare function canDownload(sensitivity: Sensitivity): boolean;
//# sourceMappingURL=engine.d.ts.map
import type { User, Role } from '../types.js';
/** 通过飞书 Open ID 查找或创建用户 */
export declare function findOrCreateByFeishu(feishuOpenId: string, name: string, opts?: {
    email?: string;
    role?: Role;
    department?: string;
}): User;
/** 通过 user_id 查找 */
export declare function getUserById(userId: string): User | null;
/** 通过飞书 Open ID 查找 */
export declare function getUserByFeishuId(feishuOpenId: string): User | null;
/** 更新用户角色 */
export declare function updateUserRole(userId: string, role: Role): void;
/** 列出所有活跃用户 */
export declare function listActiveUsers(): User[];
/** 停用用户（离职） */
export declare function deactivateUser(userId: string): void;
//# sourceMappingURL=users.d.ts.map
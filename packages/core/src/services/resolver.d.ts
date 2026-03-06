import type { Service, User } from '../types.js';
export interface ResolvedService extends Service {
    grant_source: string;
}
/**
 * 解析用户可用的服务列表。
 *
 * 优先级：
 * 1. owner → 全部 active 服务
 * 2. default_roles 包含 user.role
 * 3. service_grants (role 级)
 * 4. service_grants (user 级)
 * 5. service_grants (group 级, 联查 user_groups)
 *
 * 过滤掉 expires_at 已过期的 grants，去重返回。
 */
export declare function resolveServicesForUser(user: User): ResolvedService[];
//# sourceMappingURL=resolver.d.ts.map
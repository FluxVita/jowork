import type { Request, Response, NextFunction } from 'express';
import type { User } from '../types.js';
declare global {
    namespace Express {
        interface Request {
            user?: User;
            feishu_verified?: boolean;
        }
    }
}
/** JWT 认证中间件 */
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): void;
/**
 * 飞书认证检查中间件 — 必须在 authMiddleware 之后使用
 * 只有通过飞书 OAuth 真实认证的用户才能通过（feishu_verified=true）
 * 用于保护 AI 能力（agent chat、模型调用等）
 */
export declare function requireFeishuAuth(req: Request, res: Response, next: NextFunction): void;
/** 角色检查中间件 — 满足任一角色（或层级等价）即通过 */
export declare function requireRole(...roles: string[]): (req: Request, res: Response, next: NextFunction) => void;
/** 检查用户是否有 admin 级别权限 */
export declare function isAdminRole(role: string): boolean;
//# sourceMappingURL=middleware.d.ts.map
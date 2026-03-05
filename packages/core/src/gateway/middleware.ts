import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../auth/jwt.js';
import { getUserById } from '../auth/users.js';
import type { User } from '../types.js';

// 扩展 Express Request
declare global {
  namespace Express {
    interface Request {
      user?: User;
      feishu_verified?: boolean;
    }
  }
}

/** JWT 认证中间件 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const user = getUserById(payload.user_id);
  if (!user || !user.is_active) {
    res.status(403).json({ error: 'User not found or deactivated' });
    return;
  }

  req.user = user;
  req.feishu_verified = payload.feishu_verified === true;
  next();
}

/**
 * 飞书认证检查中间件 — 必须在 authMiddleware 之后使用
 * 只有通过飞书 OAuth 真实认证的用户才能通过（feishu_verified=true）
 * 用于保护 AI 能力（agent chat、模型调用等）
 */
export function requireFeishuAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.feishu_verified) {
    res.status(403).json({
      error: 'Feishu authentication required',
      hint: 'Please login via Feishu OAuth to use AI features.',
      login_url: '/api/auth/oauth/url',
    });
    return;
  }
  next();
}

// 角色层级（数值越高权限越大）
const ROLE_LEVEL: Record<string, number> = {
  owner: 100,
  admin: 80,
  member: 50,
  guest: 10,
};

/** 角色检查中间件 — 满足任一角色（或层级等价）即通过 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const userLevel = ROLE_LEVEL[req.user.role] ?? 0;
    const minRequired = Math.min(...roles.map(r => ROLE_LEVEL[r] ?? 999));
    if (userLevel < minRequired) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/** 检查用户是否有 admin 级别权限 */
export function isAdminRole(role: string): boolean {
  return (ROLE_LEVEL[role] ?? 0) >= ROLE_LEVEL['admin'];
}

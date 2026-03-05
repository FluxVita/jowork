import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../auth/jwt.js';
import { getUserById } from '../auth/users.js';
import { logWithContext } from '../utils/logger.js';
import type { User } from '../types.js';

/** 慢请求阈值（毫秒），超过则写 warn 日志 */
const SLOW_REQUEST_MS = 3000;
/** 需要记录耗时的路径前缀 */
const TRACK_PATHS = ['/api/agent', '/api/models', '/api/datamap', '/api/connectors'];

/** 请求日志中间件 — 记录慢请求 + 错误响应到持久化日志 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const path = req.path;

  // 只追踪 API 路径
  const shouldTrack = TRACK_PATHS.some(p => path.startsWith(p));
  if (!shouldTrack) { next(); return; }

  res.on('finish', () => {
    const duration = Date.now() - start;
    const userId = (req as Request & { user?: User }).user?.user_id;
    const status = res.statusCode;

    // 慢请求写 warn
    if (duration >= SLOW_REQUEST_MS) {
      logWithContext('warn', 'http', `SLOW ${req.method} ${path} ${status} ${duration}ms`, {
        user_id: userId,
        request_path: `${req.method} ${path}`,
        duration_ms: duration,
        context: { status, query: req.query },
      });
      return;
    }
    // 服务端错误写 error
    if (status >= 500) {
      logWithContext('error', 'http', `ERROR ${req.method} ${path} ${status} ${duration}ms`, {
        user_id: userId,
        request_path: `${req.method} ${path}`,
        duration_ms: duration,
        context: { status },
      });
    }
  });

  next();
}

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

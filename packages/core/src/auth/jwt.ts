import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { User, Role } from '../types.js';

export interface TokenPayload {
  user_id: string;
  role: Role;
  feishu_open_id: string;
  /** 是否通过飞书 OAuth 真实认证（dev 直接登录时为 false） */
  feishu_verified?: boolean;
}

/** 签发 JWT */
export function signToken(user: User, expiresIn = '24h', opts?: { feishu_verified?: boolean }): string {
  const payload: TokenPayload = {
    user_id: user.user_id,
    role: user.role,
    feishu_open_id: user.feishu_open_id,
    feishu_verified: opts?.feishu_verified ?? false,
  };
  return jwt.sign(payload, config.jwt_secret, { expiresIn: expiresIn as unknown as number });
}

/** 验证 JWT */
export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, config.jwt_secret) as TokenPayload;
  } catch {
    return null;
  }
}

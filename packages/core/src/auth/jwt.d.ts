import type { User, Role } from '../types.js';
export interface TokenPayload {
    user_id: string;
    role: Role;
    feishu_open_id: string;
    /** 是否通过飞书 OAuth 真实认证（dev 直接登录时为 false） */
    feishu_verified?: boolean;
}
/** 签发 JWT */
export declare function signToken(user: User, expiresIn?: string, opts?: {
    feishu_verified?: boolean;
}): string;
/** 验证 JWT */
export declare function verifyToken(token: string): TokenPayload | null;
//# sourceMappingURL=jwt.d.ts.map
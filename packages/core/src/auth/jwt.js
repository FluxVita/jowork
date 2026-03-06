import jwt from 'jsonwebtoken';
import { config } from '../config.js';
/** 签发 JWT */
export function signToken(user, expiresIn = '24h', opts) {
    const payload = {
        user_id: user.user_id,
        role: user.role,
        feishu_open_id: user.feishu_open_id,
        feishu_verified: opts?.feishu_verified ?? false,
    };
    return jwt.sign(payload, config.jwt_secret, { expiresIn: expiresIn });
}
/** 验证 JWT */
export function verifyToken(token) {
    try {
        return jwt.verify(token, config.jwt_secret);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=jwt.js.map
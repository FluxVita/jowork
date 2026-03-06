/**
 * lark/auth.ts
 * 内置 Lark 工具的认证辅助 — 从用户 settings 读取 user_access_token
 */
import { getUserSetting } from '../../../auth/settings.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('lark-tool-auth');
/** 获取用户的飞书 user_access_token（无效时返回 null） */
export function getLarkUserToken(userId) {
    const token = getUserSetting(userId, 'feishu_user_token');
    if (!token)
        return null;
    const expiresAtStr = getUserSetting(userId, 'feishu_user_token_expires_at');
    if (expiresAtStr) {
        const expiresAt = parseInt(expiresAtStr);
        if (!isNaN(expiresAt) && Date.now() > expiresAt) {
            log.warn(`Feishu user token expired for ${userId}`);
            return null;
        }
    }
    return token;
}
/** 不可用时返回标准错误提示 */
export const TOKEN_MISSING_MSG = '飞书操作权限未授权。请在对话页面点击"授权飞书"按钮，通过飞书 OAuth 授权后重试。';
/** 带用户 token 调用飞书 API */
export async function larkApiWithUserToken(userToken, path, opts = {}) {
    let url = `https://open.feishu.cn/open-apis${path}`;
    if (opts.params) {
        url += '?' + new URLSearchParams(opts.params).toString();
    }
    const resp = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`,
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
        throw new Error(`Feishu API ${path} HTTP ${resp.status}`);
    }
    return resp.json();
}
//# sourceMappingURL=auth.js.map
import { config } from '../../config.js';
import { httpRequest } from '../../utils/http.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('feishu-auth');
let cachedToken = null;
/** 获取飞书 tenant_access_token（自动缓存） */
export async function getTenantToken() {
    // 有效期内直接返回（提前 5 分钟刷新）
    if (cachedToken && Date.now() < cachedToken.expires_at - 300_000) {
        return cachedToken.token;
    }
    const { app_id, app_secret } = config.feishu;
    if (!app_id || !app_secret) {
        throw new Error('Feishu app_id/app_secret not configured');
    }
    const resp = await httpRequest('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        body: { app_id, app_secret },
    });
    if (resp.data.code !== 0) {
        throw new Error(`Feishu token error: ${resp.data.msg}`);
    }
    cachedToken = {
        token: resp.data.tenant_access_token,
        expires_at: Date.now() + resp.data.expire * 1000,
    };
    log.info('Feishu tenant_access_token refreshed');
    return cachedToken.token;
}
/** 带认证头的飞书 API 请求 */
export async function feishuApi(path, opts = {}) {
    const token = await getTenantToken();
    let url = `https://open.feishu.cn/open-apis${path}`;
    if (opts.params) {
        const qs = new URLSearchParams(opts.params).toString();
        url += `?${qs}`;
    }
    const resp = await httpRequest(url, {
        method: opts.method ?? 'GET',
        headers: { Authorization: `Bearer ${token}` },
        body: opts.body,
    });
    return resp.data;
}
//# sourceMappingURL=auth.js.map
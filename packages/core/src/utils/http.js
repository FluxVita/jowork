import { createLogger } from './logger.js';
const log = createLogger('http');
/** 通用 HTTP 请求工具 */
export async function httpRequest(url, opts = {}) {
    const { method = 'GET', headers = {}, body, timeout = 15_000 } = opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const fetchOpts = {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            signal: controller.signal,
        };
        if (body && method !== 'GET') {
            fetchOpts.body = JSON.stringify(body);
        }
        const resp = await fetch(url, fetchOpts);
        const data = (await resp.json());
        return { ok: resp.ok, status: resp.status, data };
    }
    catch (err) {
        log.error(`HTTP ${method} ${url} failed`, err);
        throw err;
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=http.js.map
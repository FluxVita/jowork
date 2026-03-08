import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Logs API 契约测试
 *
 * GET /api/logs — admin 内存日志（需要 admin/owner 角色）
 * GET /api/logs/mine — 个人活动日志（任意登录用户）
 */
test.describe('Logs API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/logs/mine 返回个人活动日志', async ({ request }) => {
    const res = await request.get(`${BASE}/api/logs/mine`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('sessions');
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body).toHaveProperty('toolCalls');
    expect(body).toHaveProperty('errorLogs');
    expect(body).toHaveProperty('tokenByDay');
    expect(body).toHaveProperty('days');
    expect(body).toHaveProperty('user_id');
  });

  test('GET /api/logs/mine 支持 days 参数', async ({ request }) => {
    const res = await request.get(`${BASE}/api/logs/mine?days=7`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.days).toBe(7);
  });

  test('GET /api/logs/mine 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/logs/mine`);
    expect(res.status()).toBe(401);
  });
});

import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Policy API 契约测试
 *
 * GET /api/policy/me — 返回当前用户的权限概览
 * GET /api/policy/check — 检查对象级权限
 */
test.describe('Policy API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/policy/me 返回权限概览', async ({ request }) => {
    const res = await request.get(`${BASE}/api/policy/me`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('user_id');
    expect(body).toHaveProperty('role');
    expect(body).toHaveProperty('accessible_levels');
    expect(Array.isArray(body.accessible_levels)).toBe(true);
  });

  test('GET /api/policy/me 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/policy/me`);
    expect(res.status()).toBe(401);
  });
});

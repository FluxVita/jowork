import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Services API 契约测试
 *
 * GET /api/services/mine — 当前用户可用的服务列表
 * GET /api/services — 管理员查看所有服务（需要 admin/owner）
 */
test.describe('Services API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/services/mine 返回用户可用服务', async ({ request }) => {
    const res = await request.get(`${BASE}/api/services/mine`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('services');
    expect(Array.isArray(body.services)).toBe(true);

    // 至少有一些默认服务
    if (body.services.length > 0) {
      const first = body.services[0];
      expect(first).toHaveProperty('service_id');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('type');
    }
  });

  test('GET /api/services/mine 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/services/mine`);
    expect(res.status()).toBe(401);
  });
});

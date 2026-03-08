import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Onboarding API 契约测试
 *
 * GET /api/onboarding/guide — 公开接口，返回引导数据
 * GET /api/onboarding/connectors — 需要 auth，返回连接器状态
 * GET /api/onboarding/status — 需要 auth，返回用户引导进度
 */
test.describe('Onboarding API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/onboarding/guide 返回引导数据（无需 auth）', async ({ request }) => {
    const res = await request.get(`${BASE}/api/onboarding/guide`);
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(typeof body).toBe('object');
    expect(body !== null).toBe(true);
  });

  test('GET /api/onboarding/connectors 返回连接器状态', async ({ request }) => {
    const res = await request.get(`${BASE}/api/onboarding/connectors`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('connectors');
    expect(typeof body.connectors).toBe('object');
    expect(body.connectors !== null).toBe(true);

    const entries = Object.entries(body.connectors as Record<string, unknown>);
    if (entries.length > 0) {
      const [, first] = entries[0] as [string, any];
      expect(first).toHaveProperty('ok');
      expect(first).toHaveProperty('latency_ms');
    }
  });

  test('GET /api/onboarding/status 返回引导进度', async ({ request }) => {
    const res = await request.get(`${BASE}/api/onboarding/status`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body) || typeof body === 'object').toBe(true);
  });

  test('GET /api/onboarding/connectors 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/onboarding/connectors`);
    expect(res.status()).toBe(401);
  });
});

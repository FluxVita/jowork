import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Quota API 契约测试
 *
 * GET /api/quota/dashboard — 配额仪表盘
 * GET /api/quota/feishu — 飞书配额详情
 */
test.describe('Quota API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/quota/dashboard 返回配额概览', async ({ request }) => {
    const res = await request.get(`${BASE}/api/quota/dashboard`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(typeof body).toBe('object');
    expect(body !== null).toBe(true);
  });

  test('GET /api/quota/feishu 返回飞书配额', async ({ request }) => {
    const res = await request.get(`${BASE}/api/quota/feishu`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('used');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('ratio');
    expect(body).toHaveProperty('alert_level');
  });

  test('GET /api/quota/dashboard 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/quota/dashboard`);
    expect(res.status()).toBe(401);
  });
});

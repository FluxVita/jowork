import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Billing API 契约测试
 *
 * 验证计费相关接口的返回结构。
 * 需要 auth token — 复用 global-setup 保存的 token。
 */
test.describe('Billing API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/billing/plan 返回计划信息', async ({ request }) => {
    const res = await request.get(`${BASE}/api/billing/plan`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('plan');
    expect(typeof body.plan).toBe('string');
  });

  test('GET /api/billing/credits 返回积分余额', async ({ request }) => {
    const res = await request.get(`${BASE}/api/billing/credits`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('used');
    expect(body).toHaveProperty('remaining');
    expect(typeof body.total).toBe('number');
    expect(typeof body.used).toBe('number');
    expect(typeof body.remaining).toBe('number');
    expect(body.remaining).toBe(body.total - body.used);
  });

  test('GET /api/billing/prices 返回价格列表', async ({ request }) => {
    const res = await request.get(`${BASE}/api/billing/prices`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('stripe_enabled');
    expect(typeof body.stripe_enabled).toBe('boolean');
    expect(body).toHaveProperty('prices');
    expect(Array.isArray(body.prices)).toBe(true);
  });

  test('GET /api/billing/credits/history 返回积分历史', async ({ request }) => {
    const res = await request.get(`${BASE}/api/billing/credits/history`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // 可能返回数组或包裹对象
    const items = Array.isArray(body) ? body : (body.items ?? body.history ?? []);
    expect(Array.isArray(items)).toBe(true);
  });

  test('GET /api/billing/plan 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/billing/plan`);
    expect(res.status()).toBe(401);
  });
});

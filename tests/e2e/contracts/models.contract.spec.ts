import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Models API 契约测试
 *
 * 验证模型用量和成本接口。
 * GET /api/models/usage — 任意登录用户可查自己的用量
 */
test.describe('Models API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/models/usage 返回 token 用量', async ({ request }) => {
    const res = await request.get(`${BASE}/api/models/usage`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('days');
    expect(body).toHaveProperty('since');
    expect(body).toHaveProperty('rows');
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body).toHaveProperty('totals');
    expect(body.totals).toHaveProperty('tokens_in');
    expect(body.totals).toHaveProperty('tokens_out');
    expect(body.totals).toHaveProperty('cost_usd');
    expect(body.totals).toHaveProperty('requests');
  });

  test('GET /api/models/usage 支持 days 参数', async ({ request }) => {
    const res = await request.get(`${BASE}/api/models/usage?days=7`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.days).toBe(7);
  });

  test('GET /api/models/usage 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/models/usage`);
    expect(res.status()).toBe(401);
  });
});

import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Settings API 契约测试
 *
 * 验证用户设置接口的返回结构。
 * GET /api/settings 返回所有设置，GET /api/settings/:key 返回单个值。
 */
test.describe('Settings API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/settings 返回设置列表', async ({ request }) => {
    const res = await request.get(`${BASE}/api/settings`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // 设置列表应是对象或数组
    expect(typeof body).toBe('object');
    expect(body !== null).toBe(true);
  });

  test('GET /api/settings 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/settings`);
    expect(res.status()).toBe(401);
  });

  test('PUT /api/settings/:key 可以写入设置', async ({ request }) => {
    const key = 'notification_preference';

    // 写入一个测试设置
    const res = await request.put(`${BASE}/api/settings/${key}`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { value: 'e2e_test_value' },
    });
    expect(res.status()).toBe(200);

    // 读回来验证
    const readRes = await request.get(`${BASE}/api/settings/${key}`, { headers: authHeaders() });
    expect(readRes.status()).toBe(200);
    const body = await readRes.json();
    expect(body.value).toBe('e2e_test_value');

    // 清理：删除测试设置
    await request.delete(`${BASE}/api/settings/${key}`, { headers: authHeaders() });
  });
});

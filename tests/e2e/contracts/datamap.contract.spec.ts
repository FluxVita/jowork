import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Datamap API 契约测试
 *
 * 验证数据索引搜索、对象元数据和统计接口。
 * 所有接口需要 auth。
 */
test.describe('Datamap API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/datamap/search 返回搜索结果', async ({ request }) => {
    const res = await request.get(`${BASE}/api/datamap/search`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('objects');
    expect(Array.isArray(body.objects)).toBe(true);
    expect(body).toHaveProperty('total');
    expect(typeof body.total).toBe('number');
  });

  test('GET /api/datamap/search 支持 query 参数', async ({ request }) => {
    const res = await request.get(`${BASE}/api/datamap/search?q=test&limit=5`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.objects)).toBe(true);
    expect(body.objects.length).toBeLessThanOrEqual(5);
  });

  test('GET /api/datamap/stats 返回索引统计', async ({ request }) => {
    const res = await request.get(`${BASE}/api/datamap/stats`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(typeof body).toBe('object');
    expect(body !== null).toBe(true);
  });

  test('GET /api/datamap/search 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/datamap/search`);
    expect(res.status()).toBe(401);
  });
});

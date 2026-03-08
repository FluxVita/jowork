import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Connectors API 契约测试
 *
 * 验证连接器列表和健康检查接口。
 * GET /api/connectors 需要 auth，返回 { connectors: [...] }。
 */
test.describe('Connectors API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/connectors 返回连接器列表', async ({ request }) => {
    const res = await request.get(`${BASE}/api/connectors`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // 返回包裹对象 { connectors: [...] }
    expect(body).toHaveProperty('connectors');
    expect(Array.isArray(body.connectors)).toBe(true);

    // 至少有 1 个连接器
    expect(body.connectors.length).toBeGreaterThanOrEqual(1);

    // 每个连接器应有 id 和 source
    const first = body.connectors[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('source');
    expect(typeof first.id).toBe('string');
    expect(typeof first.source).toBe('string');
  });

  test('GET /api/connectors 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/connectors`);
    expect(res.status()).toBe(401);
  });
});

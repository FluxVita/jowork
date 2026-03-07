import { test, expect } from '@playwright/test';

const BASE = process.env['GATEWAY_URL'] || 'http://localhost:18800';

/**
 * System API 契约测试
 *
 * 验证 Gateway 基础健康接口和系统信息接口的返回结构。
 */
test.describe('System API Contract @contract', () => {
  test('GET /health 返回健康状态', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);

    // health endpoint 应始终可用（无需 auth）
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body.status).toBe('ok');
  });

  test('GET /health 返回版本和运行时间', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('version');
    expect(typeof body.version).toBe('string');
    expect(body).toHaveProperty('uptime');
    expect(typeof body.uptime).toBe('number');
  });
});

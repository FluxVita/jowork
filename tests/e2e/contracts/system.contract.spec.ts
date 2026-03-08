import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

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
    expect(body).toHaveProperty('connectors');
    expect(typeof body.connectors).toBe('number');
    expect(body).toHaveProperty('db_size');
    expect(typeof body.db_size).toBe('number');
  });

  test('旧版 /api/* 响应包含弃用头，/api/v1/* 不包含', async ({ request }) => {
    const oldApi = await request.get(`${BASE}/api/auth/me`);
    expect(oldApi.headers()['deprecation']).toBe('true');
    expect(oldApi.headers()['sunset']).toBeTruthy();
    expect(oldApi.headers()['link']).toContain('/api/v1');

    const v1Api = await request.get(`${BASE}/api/v1/auth/me`);
    expect(v1Api.headers()['deprecation']).toBeUndefined();
  });
});

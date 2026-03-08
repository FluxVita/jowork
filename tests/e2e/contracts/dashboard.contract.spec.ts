import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Dashboard API 契约测试
 *
 * Dashboard 接口需要 auth（非公开），验证返回结构。
 */
test.describe('Dashboard API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/dashboard/overview 返回概览数据', async ({ request }) => {
    const res = await request.get(`${BASE}/api/dashboard/overview`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // 概览应包含数据源统计
    expect(body).toHaveProperty('total_objects');
    expect(typeof body.total_objects).toBe('number');
  });

  test('GET /api/dashboard/system 返回系统信息', async ({ request }) => {
    const res = await request.get(`${BASE}/api/dashboard/system`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // 系统信息应包含 node_version 和运行时间
    expect(body).toHaveProperty('node_version');
    expect(body).toHaveProperty('uptime_seconds');
    expect(typeof body.uptime_seconds).toBe('number');
  });

  test('GET /api/dashboard/health 返回连接器健康状态', async ({ request }) => {
    const res = await request.get(`${BASE}/api/dashboard/health`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // 应是非空响应
    expect(body !== null && body !== undefined).toBe(true);
  });

  test('GET /api/dashboard/overview 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/dashboard/overview`);
    expect(res.status()).toBe(401);
  });
});

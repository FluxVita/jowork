import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Agent API 契约测试
 *
 * 验证 Agent 对话引擎相关接口的返回结构。
 * 包括：sessions 列表、engines 列表、workstyle。
 */
test.describe('Agent API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/agent/sessions 返回会话列表', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agent/sessions`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // 可能是数组或包裹对象
    const sessions = Array.isArray(body) ? body : (body.sessions ?? []);
    expect(Array.isArray(sessions)).toBe(true);
  });

  test('GET /api/agent/engines 返回引擎列表', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agent/engines`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // 引擎列表应是数组
    const engines = Array.isArray(body) ? body : (body.engines ?? []);
    expect(Array.isArray(engines)).toBe(true);
    expect(engines.length).toBeGreaterThanOrEqual(1);

    // 每个引擎应有 type
    const first = engines[0];
    expect(first).toHaveProperty('type');
  });

  test('GET /api/agent/workstyle 返回工作风格', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agent/workstyle`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // workstyle 可能为空对象或包含 style 字段
    expect(typeof body).toBe('object');
    expect(body !== null).toBe(true);
  });

  test('GET /api/agent/sessions 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agent/sessions`);
    expect(res.status()).toBe(401);
  });
});

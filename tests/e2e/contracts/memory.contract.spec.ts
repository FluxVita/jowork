import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Memory API 契约测试
 *
 * 验证 Agent 记忆系统接口。
 * Memory API 通常不需要 auth（内部使用）。
 */
test.describe('Memory API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/memory 返回记忆列表', async ({ request }) => {
    const res = await request.get(`${BASE}/api/memory`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // 记忆列表应是数组
    const items = Array.isArray(body) ? body : (body.items ?? body.memories ?? []);
    expect(Array.isArray(items)).toBe(true);
  });

  test('POST /api/memory 创建记忆条目', async ({ request }) => {
    const res = await request.post(`${BASE}/api/memory`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { title: 'E2E test memory title', content: 'E2E test memory entry', tags: ['test'] },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();

    expect(body).toHaveProperty('memory');
    expect(typeof body.memory.memory_id).toBe('string');

    // 清理
    if (body.memory?.memory_id) {
      await request.delete(`${BASE}/api/memory/${body.memory.memory_id}`, { headers: authHeaders() });
    }
  });

  test('GET /api/memory/:id 获取单条记忆', async ({ request }) => {
    // 先创建
    const create = await request.post(`${BASE}/api/memory`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { title: 'E2E single memory title', content: 'E2E single memory', tags: ['test'] },
    });
    expect(create.status()).toBe(201);
    const created = await create.json();
    const memoryId = created.memory.memory_id;

    const res = await request.get(`${BASE}/api/memory/${memoryId}`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('memory');
    expect(body.memory.content).toBe('E2E single memory');

    // 清理
    await request.delete(`${BASE}/api/memory/${memoryId}`, { headers: authHeaders() });
  });
});

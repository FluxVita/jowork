import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Files API 契约测试
 *
 * 验证本地文件系统接口（home / dir / content）。
 * 所有接口需要 auth（router.use(authMiddleware)）。
 */
test.describe('Files API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('GET /api/files/home 返回 home 目录', async ({ request }) => {
    const res = await request.get(`${BASE}/api/files/home`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('path');
    expect(typeof body.path).toBe('string');
    expect(body.path.length).toBeGreaterThan(0);
  });

  test('GET /api/files/dir 列出目录内容', async ({ request }) => {
    // 用 home 目录做测试
    const homeRes = await request.get(`${BASE}/api/files/home`, { headers: authHeaders() });
    const { path: homePath } = await homeRes.json();

    const res = await request.get(`${BASE}/api/files/dir?path=${encodeURIComponent(homePath)}`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);

    // Home 目录至少有一些条目
    if (body.entries.length > 0) {
      const first = body.entries[0];
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('path');
      expect(first).toHaveProperty('is_dir');
      expect(first).toHaveProperty('ext');
    }
  });

  test('GET /api/files/dir 缺少 path 返回 400', async ({ request }) => {
    const res = await request.get(`${BASE}/api/files/dir`, { headers: authHeaders() });
    expect(res.status()).toBe(400);
  });

  test('GET /api/files/home 无 token 返回 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/files/home`);
    expect(res.status()).toBe(401);
  });
});

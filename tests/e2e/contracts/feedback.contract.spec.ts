import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

/**
 * Feedback API 契约测试
 *
 * POST /api/feedback — 提交反馈（需要 auth，除非 PUBLIC_FEEDBACK_ENABLED）
 * GET /api/feedback — 获取最新反馈
 */
test.describe('Feedback API Contract @contract', () => {
  let token: string;

  test.beforeAll(async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const auth = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));
    token = auth.token;
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  test('POST /api/feedback 提交反馈', async ({ request }) => {
    const res = await request.post(`${BASE}/api/feedback`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { page: 'e2e-test', url: 'http://test/e2e', content: 'E2E test feedback' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('message');
  });

  test('POST /api/feedback 空内容返回 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/feedback`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: { page: 'test', content: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/feedback 获取反馈内容', async ({ request }) => {
    const res = await request.get(`${BASE}/api/feedback`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('raw');
    expect(typeof body.raw).toBe('string');
  });
});

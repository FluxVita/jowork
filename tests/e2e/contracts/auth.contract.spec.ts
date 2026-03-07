import { test, expect } from '@playwright/test';

const BASE = process.env['FLUXVITA_URL'] || 'http://localhost:18800';

// 每个测试用不同的 feishu_open_id，避免 IP rate limit (5次/30s)
let testCounter = 0;
function uniqueDevId() {
  return `ou_test_contract_${Date.now()}_${++testCounter}`;
}

/**
 * Auth API 契约测试
 *
 * 纯 API 调用（无浏览器），验证接口返回结构不变。
 * 当后端改了字段名/类型，这些测试会第一时间告警。
 */
test.describe('Auth API Contract @contract', () => {
  // 串行执行，避免并发打同一 IP 触发 rate limit
  test.describe.configure({ mode: 'serial' });

  test('POST /api/auth/login Step 1 返回 challenge', async ({ request }) => {
    const devId = uniqueDevId();
    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { feishu_open_id: devId, name: 'Contract-Step1' },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('challenge_id');
    expect(body).toHaveProperty('dev_code');
    expect(typeof body.challenge_id).toBe('string');
    expect(typeof body.dev_code).toBe('string');
    expect(body.challenge_id.length).toBeGreaterThan(0);
  });

  test('POST /api/auth/login Step 2 返回 token + user', async ({ request }) => {
    const devId = uniqueDevId();

    // Step 1
    const step1 = await request.post(`${BASE}/api/auth/login`, {
      data: { feishu_open_id: devId, name: 'Contract-Step2' },
    });
    expect(step1.status()).toBe(200);
    const { challenge_id, dev_code } = await step1.json();

    // Step 2
    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { feishu_open_id: devId, challenge_id, code: dev_code },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();

    // 契约：token 字段
    expect(body).toHaveProperty('token');
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(3); // JWT = header.payload.signature

    // 契约：user 对象
    expect(body).toHaveProperty('user');
    expect(body.user).toHaveProperty('user_id');
    expect(body.user).toHaveProperty('name');
    expect(body.user).toHaveProperty('role');
    expect(typeof body.user.user_id).toBe('string');
    expect(typeof body.user.name).toBe('string');
  });

  test('GET /api/auth/me 需要 Authorization header', async ({ request }) => {
    const res = await request.get(`${BASE}/api/auth/me`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/me 有效 token 返回 user', async ({ request }) => {
    // 复用 global-setup 保存的 token，避免消耗 rate limit
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { token } = JSON.parse(readFileSync(join(import.meta.dirname, '..', '.auth', 'fluxvita.json'), 'utf-8'));

    const res = await request.get(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // /api/auth/me 可能返回包裹结构或扁平的 user
    const user = body.user ?? body;
    expect(user).toHaveProperty('user_id');
    expect(user).toHaveProperty('name');
    expect(user).toHaveProperty('role');
  });

  test('POST /api/auth/login 缺 feishu_open_id 返回 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { name: 'NoOpenId' },
    });
    // 可能 429（IP rate limit），跳过而非假 fail
    if (res.status() === 429) { test.skip(true, 'IP rate limited'); return; }
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/auth/login 错误 code 返回 401', async ({ request }) => {
    const devId = uniqueDevId();
    const s1 = await request.post(`${BASE}/api/auth/login`, {
      data: { feishu_open_id: devId, name: 'Contract-WrongCode' },
    });
    if (s1.status() === 429) { test.skip(true, 'IP rate limited'); return; }
    const { challenge_id } = await s1.json();

    const res = await request.post(`${BASE}/api/auth/login`, {
      data: { feishu_open_id: devId, challenge_id, code: 'wrong-code' },
    });
    expect(res.status()).toBe(401);
  });
});

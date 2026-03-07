import { test as base, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 通过 dev login API 获取 JWT token（两步 challenge 流程）
 */
export async function authenticate(
  request: APIRequestContext,
  baseURL: string,
  devOpenId = 'ou_test_e2e_user_001',
  devName = 'E2E-Test',
): Promise<{ token: string; user: { user_id: string; name: string; role: string } }> {
  // Step 1: 创建 challenge
  const step1 = await request.post(`${baseURL}/api/auth/login`, {
    data: { feishu_open_id: devOpenId, name: devName },
  });
  if (!step1.ok()) {
    const body = await step1.text();
    throw new Error(`Login step 1 failed (${step1.status()}): ${body}`);
  }
  const { challenge_id, dev_code } = await step1.json();

  // Step 2: 提交 challenge code
  const step2 = await request.post(`${baseURL}/api/auth/login`, {
    data: { feishu_open_id: devOpenId, challenge_id, code: dev_code },
  });
  if (!step2.ok()) {
    const body = await step2.text();
    throw new Error(`Login step 2 failed (${step2.status()}): ${body}`);
  }
  return step2.json();
}

/**
 * 读取 global-setup 保存的 token（按产品区分文件）
 */
function loadSavedToken(product: 'fluxvita' | 'jowork'): {
  token: string;
  user: { user_id: string; name: string; role: string };
} {
  const path = join(import.meta.dirname, '..', '.auth', `${product}.json`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * 将 JWT token 注入到 localStorage，模拟已登录状态
 *
 * FluxVita 用 `fluxvita_token`，Jowork 用 `jowork_token`
 */
async function injectToken(page: Page, product: 'fluxvita' | 'jowork') {
  const { token, user } = loadSavedToken(product);
  const key = product === 'jowork' ? 'jowork_token' : 'fluxvita_token';
  await page.addInitScript(({ k, t, u }) => {
    localStorage.setItem(k, t);
    localStorage.setItem('user', JSON.stringify(u));
  }, { k: key, t: token, u: user });
}

/**
 * 扩展后的 test fixture，自动注入认证态
 */
export const test = base.extend<{
  authedPage: Page;
  joworkPage: Page;
  fluxvitaPage: Page;
  authToken: string;
}>({
  authToken: async ({}, use) => {
    const { token } = loadSavedToken('fluxvita');
    await use(token);
  },
  authedPage: async ({ page }, use) => {
    await injectToken(page, 'jowork');
    await use(page);
  },
  joworkPage: async ({ page }, use) => {
    await injectToken(page, 'jowork');
    await use(page);
  },
  fluxvitaPage: async ({ page }, use) => {
    await injectToken(page, 'fluxvita');
    await use(page);
  },
});

export { expect } from '@playwright/test';

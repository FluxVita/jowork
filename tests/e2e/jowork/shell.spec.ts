import { test, expect } from '../fixtures/auth';

/**
 * Jowork Shell（主框架）E2E 测试
 *
 * shell.html 是 Jowork 的主入口。
 * 注意：shell.html 检查 /api/system/setup-status，如果 done=false 会跳到 setup.html。
 * 需要 mock 这个 API 才能正常测试 shell 本身。
 */
test.describe('Jowork Shell @smoke', () => {
  test('登录后加载 shell 主界面', async ({ joworkPage: page }) => {
    // Mock setup-status 返回 done=true，防止跳到 setup.html
    await page.route('**/api/system/setup-status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ done: true }) }),
    );

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');

    // 等待 sidebar 可见（shell 加载完成的标志）
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test('未登录时显示 login screen', async ({ page }) => {
    await page.addInitScript(() => { localStorage.clear(); });

    // Mock setup-status 返回 done=true
    await page.route('**/api/system/setup-status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ done: true }) }),
    );

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');

    const loginScreen = page.locator('#login-screen');
    await expect(loginScreen).toBeVisible({ timeout: 8000 });
  });
});

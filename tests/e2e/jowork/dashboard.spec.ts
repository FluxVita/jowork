import { test, expect } from '../fixtures/auth';

/**
 * Jowork Dashboard 看板 E2E 测试
 *
 * dashboard.html 展示 PostHog / GitLab / Personal 数据。
 * 需要 jowork_token，通过 subtab 切换不同数据源。
 */
test.describe('Jowork Dashboard @smoke', () => {
  test('登录后加载看板页面', async ({ joworkPage: page }) => {
    await page.route('**/api/dashboard/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
    );

    await page.goto('/dashboard.html');
    await page.waitForLoadState('networkidle');

    // 内容区域应可见
    const content = page.locator('#content');
    await expect(content).toBeVisible({ timeout: 5000 });
  });

  test('Subtab 切换功能', async ({ joworkPage: page }) => {
    await page.route('**/api/dashboard/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
    );

    await page.goto('/dashboard.html');
    await page.waitForLoadState('networkidle');

    // subtab 导航应存在
    const subtabs = page.locator('.subtab');
    const count = await subtabs.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // 默认应有一个 active tab
    await expect(page.locator('.subtab.active')).toHaveCount(1);

    // 点击非 active 的 tab
    if (count > 1) {
      const secondTab = subtabs.nth(1);
      const wasActive = await secondTab.evaluate(el => el.classList.contains('active'));
      if (!wasActive) {
        await secondTab.click();
        await expect(secondTab).toHaveClass(/active/);
      }
    }
  });
});

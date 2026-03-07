import { test, expect } from '../fixtures/auth';

/**
 * FluxVita Admin 管理后台测试
 *
 * admin.html 需要登录态 + admin/owner 角色。
 * 验证 Tab 导航、用户列表、服务管理等核心功能。
 */
test.describe('FluxVita Admin @regression', () => {
  test('管理后台页面加载', async ({ fluxvitaPage: page }) => {
    await page.goto('/admin.html');

    await expect(page).toHaveTitle(/管理后台|Admin/i);

    // header 和 tab 栏
    const header = page.locator('.header');
    await expect(header).toBeVisible();

    const tabs = page.locator('.tabs');
    await expect(tabs).toBeVisible();
  });

  test('Tab 导航可切换', async ({ fluxvitaPage: page }) => {
    await page.goto('/admin.html');

    const tabs = page.locator('.tab');
    await expect(tabs.first()).toBeVisible({ timeout: 5000 });

    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // 切换到第二个 tab
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveClass(/active/);
  });
});

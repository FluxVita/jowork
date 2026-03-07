import { test, expect } from '../fixtures/auth';

/**
 * FluxVita Dashboard 看板测试
 *
 * dashboard.html 是公开页面（不需要登录），包含数据卡片和子 tab。
 */
test.describe('FluxVita Dashboard @smoke', () => {
  test('看板页面正常加载', async ({ page }) => {
    await page.goto('/dashboard.html');

    // 标题
    await expect(page).toHaveTitle(/数据看板|Dashboard/i);

    // subtab 导航栏可见
    const subtabs = page.locator('.subtabs');
    await expect(subtabs).toBeVisible();
  });

  test('内容区域渲染', async ({ page }) => {
    await page.goto('/dashboard.html');

    // content 区域应存在（grid 需要 connector 数据，可能为空）
    const content = page.locator('.content');
    await expect(content).toBeVisible({ timeout: 8000 });
  });

  test('子 tab 切换功能', async ({ page }) => {
    await page.goto('/dashboard.html');

    const tabs = page.locator('.subtab');
    const count = await tabs.count();
    if (count < 2) {
      test.skip(true, '只有一个 subtab，跳过切换测试');
      return;
    }

    // 点击第二个 tab
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveClass(/active/);
  });
});

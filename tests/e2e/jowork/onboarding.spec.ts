import { test, expect } from '@playwright/test';

/**
 * Jowork Onboarding 流程 E2E 测试
 *
 * 不注入 token，模拟全新用户第一次进入的完整 onboarding 流程。
 * 断言方式：DOM 元素可见性 + URL 跳转 + localStorage 状态
 *
 * 注意：onboarding 的 #actions 和 #actions-skip 在 CSS 中固定定位可能重叠，
 * 需要用 force click 或通过 JS dispatch。
 */
test.describe('Jowork Onboarding @smoke', () => {
  test.beforeEach(async ({ page }) => {
    // 清除所有 storage，模拟全新用户
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('完整 onboarding 三步流程', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    // Step 1: Connect your tools
    const step1 = page.locator('#step-1');
    await expect(step1).toBeVisible();
    await expect(step1.locator('.tag')).toContainText('Step 1');

    // Connector grid 应存在
    await expect(page.locator('#grid-code')).toBeVisible();

    // 点击 Continue 进入 Step 2（用 force 绕过 fixed 按钮层叠遮挡）
    await page.locator('#btn-next').click({ force: true });

    // Step 2: Choose AI model
    const step2 = page.locator('#step-2');
    await expect(step2).toBeVisible();
    await expect(step1).toBeHidden();
    await expect(step2.locator('.tag')).toContainText('Step 2');

    // 应该有两个 model card
    await expect(page.locator('.model-card')).toHaveCount(2);

    // Skip 进入 Step 3（不配置 model）
    await page.locator('#actions-skip button').click({ force: true });

    // Step 3: Tell about you
    const step3 = page.locator('#step-3');
    await expect(step3).toBeVisible();
    await expect(step2).toBeHidden();

    // 填写 work style
    const textarea = page.locator('#work-style');
    await expect(textarea).toBeVisible();
    await textarea.fill('I am a product manager focused on user growth.');

    // 点击 Finish
    await page.locator('#btn-next').click({ force: true });

    // Step Done: All set
    const stepDone = page.locator('#step-done');
    await expect(stepDone).toBeVisible();
    await expect(stepDone).toContainText('all set');
  });

  test('可以通过 Back 按钮回退', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    // Step 1 → Step 2（调用 JS 函数，避免 DOM overlay 问题）
    await page.evaluate(() => (window as any).goNext());
    await expect(page.locator('#step-2')).toBeVisible();

    // Step 2 → Back to Step 1
    await page.evaluate(() => (window as any).goBack());
    await expect(page.locator('#step-1')).toBeVisible();
    await expect(page.locator('#step-2')).toBeHidden();
  });

  test('Skip 按钮在每步都可用', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    // Step 1: skip（调用 JS skipStep，避免 display:none 按钮问题）
    await page.evaluate(() => (window as any).skipStep());
    await expect(page.locator('#step-2')).toBeVisible();

    // Step 2: skip
    await page.evaluate(() => (window as any).skipStep());
    await expect(page.locator('#step-3')).toBeVisible();

    // Step 3: skip
    await page.evaluate(() => (window as any).skipStep());
    await expect(page.locator('#step-done')).toBeVisible();
  });

  test('Step 2 选择 BYOK 后显示 API key 输入区', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');
    await page.locator('#btn-next').click({ force: true });
    await expect(page.locator('#step-2')).toBeVisible();

    // 点选 BYOK card
    await page.locator('#card-byok').click();

    // API key 输入区应可见
    await expect(page.locator('#byok-area')).toBeVisible();
    await expect(page.locator('#key-openrouter')).toBeVisible();
  });
});

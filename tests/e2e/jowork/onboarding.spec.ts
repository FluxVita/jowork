import { test, expect } from '@playwright/test';

/**
 * Jowork Onboarding 流程 E2E 深度交互测试
 *
 * onboarding.html 是 3 步引导向导（connectors -> model -> work style -> done）。
 * 不注入 token，模拟全新用户第一次进入。
 *
 * 注意：#actions 和 #actions-skip 在 CSS 中 position:fixed，可能重叠，
 * 需要用 force click 或 evaluate() 调用全局函数绕过。
 */

/* ── 共用 mock ── */
function mockOnboardingAPIs(page: import('@playwright/test').Page) {
  return Promise.all([
    page.route('**/api/system/setup-status', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ setup_complete: false, hosting_mode: 'self_hosted' }),
      }),
    ),
    page.route('**/api/auth/local', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-onboard-token', user: { user_id: 'usr_ob', name: 'Onboard User', role: 'owner' } }),
      }),
    ),
    page.route('**/api/connectors/health', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ connectors: [] }),
      }),
    ),
    page.route('**/api/settings', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }),
    ),
    page.route('**/api/context/docs', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }),
    ),
    page.route('**/api/agent/workstyle', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }),
    ),
  ]);
}

test.describe('Jowork Onboarding 引导流程', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await mockOnboardingAPIs(page);
  });

  test('引导页加载', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    // Step 1 可见
    const step1 = page.locator('#step-1');
    await expect(step1).toBeVisible();
    await expect(step1.locator('.tag')).toContainText('Step 1');

    // progress bar 可见，seg-1 为 active
    const seg1 = page.locator('#seg-1');
    await expect(seg1).toHaveClass(/active/);
  });

  test('连接器卡片显示', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#step-1')).toBeVisible();

    // connector grid 已渲染（JS 动态生成）
    await expect(page.locator('#grid-code')).toBeVisible();

    // 至少有一个 conn-card
    const cards = page.locator('.conn-card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // 每个 card 有名称和状态
    const firstCard = cards.first();
    await expect(firstCard.locator('.conn-name')).toBeVisible();
    await expect(firstCard.locator('.conn-status')).toBeVisible();
  });

  test('跳过按钮', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#step-1')).toBeVisible();

    // 用 JS 调用 skipStep 绕过 fixed overlay 问题
    await page.evaluate(() => (window as any).skipStep());

    // 应到 step 2
    await expect(page.locator('#step-2')).toBeVisible();
    await expect(page.locator('#step-1')).toBeHidden();
  });

  test('Next 按钮导航', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#step-1')).toBeVisible();

    // 点击 Continue（force click 绕过 fixed overlay）
    await page.locator('#btn-next').click({ force: true });

    // Step 2 可见
    await expect(page.locator('#step-2')).toBeVisible();
    await expect(page.locator('#step-1')).toBeHidden();

    // progress bar 更新：seg-1 完成，seg-2 active
    await expect(page.locator('#seg-1')).toHaveClass(/done/);
    await expect(page.locator('#seg-2')).toHaveClass(/active/);
  });

  test('Back 按钮导航', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    // 先到 step 2
    await page.evaluate(() => (window as any).goNext());
    await expect(page.locator('#step-2')).toBeVisible();

    // Back 返回 step 1
    await page.evaluate(() => (window as any).goBack());
    await expect(page.locator('#step-1')).toBeVisible();
    await expect(page.locator('#step-2')).toBeHidden();
  });

  test('BYOK 卡片选择', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    // 导航到 step 2
    await page.evaluate(() => (window as any).goNext());
    await expect(page.locator('#step-2')).toBeVisible();

    // BYOK 卡片可能已经因为 self_hosted 模式被自动选中
    // 手动确认：点击 BYOK
    const byokCard = page.locator('#card-byok');
    await byokCard.click();

    // 应有 .selected class
    await expect(byokCard).toHaveClass(/selected/);

    // BYOK area 可见
    const byokArea = page.locator('#byok-area');
    await expect(byokArea).toBeVisible();
  });

  test('API Key 输入', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    // 到 step 2
    await page.evaluate(() => (window as any).goNext());
    await expect(page.locator('#step-2')).toBeVisible();

    // 选择 BYOK
    await page.locator('#card-byok').click();
    await expect(page.locator('#byok-area')).toBeVisible();

    // 填写 OpenRouter key
    const keyInput = page.locator('#key-openrouter');
    await expect(keyInput).toBeVisible();
    await keyInput.fill('sk-or-test-key-12345');

    // 验证值
    await expect(keyInput).toHaveValue('sk-or-test-key-12345');
  });

  test('工作风格 prompt chips', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    // Skip to step 3 — goNext() on step 2 calls saveModelSettings() which fails
    // when hosting_mode is self_hosted (BYOK auto-selected, requires API key).
    // Use skipStep() to bypass validation.
    await page.evaluate(() => (window as any).goNext());
    await page.evaluate(() => (window as any).skipStep());
    await expect(page.locator('#step-3')).toBeVisible();

    // prompt chips 应存在
    const chips = page.locator('.prompt-chip');
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThan(0);

    // 获取第一个 chip 的文本
    const firstChip = chips.first();
    const chipText = await firstChip.textContent();

    // 点击 chip
    await firstChip.click();

    // textarea 应包含 chip 文本
    const textarea = page.locator('#work-style');
    const textareaValue = await textarea.inputValue();
    expect(textareaValue).toContain(chipText!.trim());
  });

  test('工作风格输入', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    // Skip to step 3 — goNext() on step 2 calls saveModelSettings() which fails
    // when hosting_mode is self_hosted (BYOK auto-selected, requires API key).
    // Use skipStep() to bypass validation.
    await page.evaluate(() => (window as any).goNext());
    await page.evaluate(() => (window as any).skipStep());
    await expect(page.locator('#step-3')).toBeVisible();

    // textarea 可见
    const textarea = page.locator('#work-style');
    await expect(textarea).toBeVisible();

    // 输入工作风格
    await textarea.fill('I am a product manager focused on user growth. I like bullet points.');

    // 验证值
    await expect(textarea).toHaveValue(/product manager/);
  });

  test('完成步骤', async ({ page }) => {
    await page.goto('/onboarding.html');
    await page.waitForLoadState('networkidle');

    // Step 1 → Skip
    await page.evaluate(() => (window as any).skipStep());
    await expect(page.locator('#step-2')).toBeVisible();

    // Step 2 → Skip
    await page.evaluate(() => (window as any).skipStep());
    await expect(page.locator('#step-3')).toBeVisible();

    // Step 3 → 填写工作风格然后 Next
    const textarea = page.locator('#work-style');
    await textarea.fill('I prefer concise answers with code examples.');

    // 点击 Finish（goNext on step 3 → done）
    await page.locator('#btn-next').click({ force: true });

    // Done step 可见
    const stepDone = page.locator('#step-done');
    await expect(stepDone).toBeVisible({ timeout: 5000 });

    // done summary 可见
    const summary = page.locator('#done-summary');
    await expect(summary).toBeVisible();

    // 包含 "all set" 文本
    await expect(stepDone).toContainText('all set', { ignoreCase: true });

    // progress bar 全部 done
    await expect(page.locator('#seg-1')).toHaveClass(/done/);
    await expect(page.locator('#seg-2')).toHaveClass(/done/);
    await expect(page.locator('#seg-3')).toHaveClass(/done/);
  });
});

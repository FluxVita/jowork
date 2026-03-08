import { test, expect } from '../fixtures/auth';
import type { Page, Route } from '@playwright/test';

/**
 * FluxVita Onboarding 引导页 E2E 测试
 *
 * onboarding.html 是 9 步引导向导（step-1 ~ step-9）。
 * Steps 1-3 是介绍页（无进度条），Steps 4-9 是配置步骤（有进度条）。
 * 全局固定按钮区 #global-actions 管理导航按钮。
 */

// ── Mock 路由 ──

async function mockAllRoutes(page: Page) {
  await page.route('**/api/auth/me', (route: Route) =>
    route.fulfill({ json: { user: { user_id: 'usr_1', name: 'Test User', role: 'admin' } } }));

  await page.route('**/api/onboarding/status', (route: Route) =>
    route.fulfill({ json: { step: 1, completed: false } }));

  await page.route('**/api/onboarding/guide', (route: Route) =>
    route.fulfill({ json: { steps: 9 } }));

  await page.route('**/api/auth/login', (route: Route) =>
    route.fulfill({
      json: {
        challenge_id: 'ch_1',
        dev_code: '123456',
        token: 'mock-jwt-token',
        user: { user_id: 'usr_1', name: 'Test User', role: 'admin' },
      },
    }));

  await page.route('**/api/auth/oauth/url', (route: Route) =>
    route.fulfill({ json: { url: 'https://feishu.example.com/oauth' } }));

  await page.route('**/api/agent/workstyle', (route: Route) => {
    if (route.request().method() === 'PUT') {
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { content: '' } });
  });

  await page.route('**/api/connectors**', (route: Route) =>
    route.fulfill({ json: { connectors: [] } }));

  await page.route('**/api/context/docs**', (route: Route) =>
    route.fulfill({ json: { docs: [] } }));
}

async function gotoOnboarding(page: Page) {
  await mockAllRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem('fluxvita_token', 'mock-jwt-token');
    localStorage.setItem('fv_token', 'mock-jwt-token');
  });
  await page.goto('/onboarding.html');
  // Wait for step 1 to be visible
  await page.locator('#step-1.visible').waitFor({ timeout: 5000 });
}

// Helper: click the primary button in the global actions area
async function clickPrimaryBtn(page: Page) {
  const btn = page.locator('#global-actions .btn-primary');
  await btn.waitFor({ state: 'visible', timeout: 3000 });
  await btn.click();
}

// Helper: click back/ghost button
async function clickBackBtn(page: Page) {
  const btn = page.locator('#global-actions .btn-ghost', { hasText: /返回/ });
  await btn.waitFor({ state: 'visible', timeout: 3000 });
  await btn.click();
}

// ═══════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════

test.describe('FluxVita Onboarding @regression', () => {

  // 1. 引导页面正常加载 — Step 1 可见
  test('引导页面加载 — Step 1 可见 + 品牌内容', async ({ page }) => {
    await gotoOnboarding(page);

    const step1 = page.locator('#step-1');
    await expect(step1).toBeVisible();
    await expect(step1).toHaveClass(/visible/);

    // 品牌标识
    await expect(page.locator('.brand')).toBeVisible();
    await expect(page.locator('.brand')).toContainText('FluxVita');

    // H1 标题
    await expect(step1.locator('.h1')).toBeVisible();

    // 数据源标签
    const pills = page.locator('.source-pill');
    const count = await pills.count();
    expect(count).toBeGreaterThanOrEqual(5);

    // 进度条在 step 1-3 时应隐藏
    await expect(page.locator('#prog-bar')).toHaveClass(/hidden/);

    // 其他 steps 应该不可见
    await expect(page.locator('#step-2')).not.toHaveClass(/visible/);
    await expect(page.locator('#step-3')).not.toHaveClass(/visible/);
  });

  // 2. Step 1 -> Step 2 导航
  test('Step 1 -> Step 2 — 点击按钮前进', async ({ page }) => {
    await gotoOnboarding(page);

    // 全局按钮区应显示 "开始配置" 按钮
    const primaryBtn = page.locator('#global-actions .btn-primary');
    await expect(primaryBtn).toBeVisible();
    await expect(primaryBtn).toContainText(/开始配置/);

    // Click to advance
    await primaryBtn.click();

    // Step 2 should now be visible
    await expect(page.locator('#step-2')).toHaveClass(/visible/);
    await expect(page.locator('#step-1')).not.toHaveClass(/visible/);

    // Step 2 content: data isolation
    await expect(page.locator('#step-2 .h1')).toContainText(/隔离/);
  });

  // 3. Step 2 -> Step 3 导航 + 返回
  test('Step 2 -> Step 3 导航 + Step 2 返回 Step 1', async ({ page }) => {
    await gotoOnboarding(page);

    // Go to step 2
    await clickPrimaryBtn(page);
    await expect(page.locator('#step-2')).toHaveClass(/visible/);

    // Should have a back button
    const backBtn = page.locator('#global-actions .btn-ghost', { hasText: /返回/ });
    await expect(backBtn).toBeVisible();

    // Go to step 3
    await clickPrimaryBtn(page);
    await expect(page.locator('#step-3')).toHaveClass(/visible/);
    await expect(page.locator('#step-3 .h1')).toContainText(/自主/);

    // Go back to step 2
    await clickBackBtn(page);
    await expect(page.locator('#step-2')).toHaveClass(/visible/);
    await expect(page.locator('#step-3')).not.toHaveClass(/visible/);

    // Go back to step 1
    await clickBackBtn(page);
    await expect(page.locator('#step-1')).toHaveClass(/visible/);
  });

  // 4. 进度条在 Step 4+ 显示
  test('进度条在 Step 4+ 可见且正确更新', async ({ page }) => {
    await gotoOnboarding(page);

    // Navigate to step 4 (1 -> 2 -> 3 -> 4)
    await clickPrimaryBtn(page); // step 2
    await clickPrimaryBtn(page); // step 3
    await clickPrimaryBtn(page); // step 4

    await expect(page.locator('#step-4')).toHaveClass(/visible/);

    // Progress bar should be visible now
    const progBar = page.locator('#prog-bar');
    await expect(progBar).not.toHaveClass(/hidden/);

    // Should have prog-seg elements
    const segments = progBar.locator('.prog-seg');
    const segCount = await segments.count();
    expect(segCount).toBeGreaterThanOrEqual(1);

    // Current segment (step 4) should be active
    // Steps 1-3 are intro (done), step 4 is active
    const doneSegs = progBar.locator('.prog-seg.done');
    const activeSegs = progBar.locator('.prog-seg.active');
    const doneCount = await doneSegs.count();
    const activeCount = await activeSegs.count();
    expect(doneCount).toBeGreaterThanOrEqual(1);
    expect(activeCount).toBe(1);
  });

  // 5. Step 4 (登录) — dev 模式登录
  test('Step 4 登录页 — 开发模式登录界面', async ({ page }) => {
    await gotoOnboarding(page);

    // Navigate to step 4
    await clickPrimaryBtn(page); // 2
    await clickPrimaryBtn(page); // 3
    await clickPrimaryBtn(page); // 4

    await expect(page.locator('#step-4')).toHaveClass(/visible/);

    // OAuth main button should be in the global actions
    const oauthBtn = page.locator('#global-actions #oauth-btn');
    await expect(oauthBtn).toBeVisible();
    await expect(oauthBtn).toContainText(/飞书/);

    // Dev login section should be collapsible
    const details = page.locator('#step-4 details');
    await expect(details).toBeVisible();

    // Open dev login details
    await details.locator('summary').click();

    // Dev login fields should be visible
    await expect(page.locator('#dev-id')).toBeVisible();
    await expect(page.locator('#dev-name')).toBeVisible();
  });

  // 6. 向导全程导航 — Step 1 到 Step 5
  test('向导导航 — Step 1 到 Step 5 飞书已连接', async ({ page }) => {
    await gotoOnboarding(page);

    // Step 1 -> 2
    await clickPrimaryBtn(page);
    await expect(page.locator('#step-2')).toHaveClass(/visible/);

    // Step 2 -> 3
    await clickPrimaryBtn(page);
    await expect(page.locator('#step-3')).toHaveClass(/visible/);

    // Step 3 -> 4
    await clickPrimaryBtn(page);
    await expect(page.locator('#step-4')).toHaveClass(/visible/);

    // Simulate login: manually inject token and call goStep(5) via JS
    // In real flow, OAuth would redirect. We simulate by calling nextStep.
    await page.evaluate(() => {
      (window as any).token = 'mock-jwt-token';
      (window as any).user = { user_id: 'usr_1', name: 'Test', role: 'admin' };
      (window as any).goStep(5);
    });

    // Step 5: "飞书已连接"
    await expect(page.locator('#step-5')).toHaveClass(/visible/);
    await expect(page.locator('#step-5 .h1')).toContainText(/已连接/);

    // Connected items should list feishu features
    const connectedItems = page.locator('#step-5 .connected-item');
    const connectedCount = await connectedItems.count();
    expect(connectedCount).toBeGreaterThanOrEqual(2);
  });

  // 7. 向导导航 — Step 5 到 Step 9 完成页
  test('向导导航 — Step 5 到 Step 9 完成页', async ({ page }) => {
    await gotoOnboarding(page);

    // Jump directly to step 5 (simulate post-login)
    await page.evaluate(() => {
      (window as any).token = 'mock-jwt-token';
      (window as any).user = { user_id: 'usr_1', name: 'Test', role: 'admin' };
      (window as any).roles = ['dev'];
      (window as any).goStep(5);
    });

    await expect(page.locator('#step-5')).toHaveClass(/visible/);

    // Step 5 -> 6 (工作方式)
    await clickPrimaryBtn(page);
    await expect(page.locator('#step-6')).toHaveClass(/visible/);
    await expect(page.locator('#step-6 .h1')).toContainText(/工作方式/);

    // Step 6: skip via ghost button
    const skipBtn = page.locator('#global-actions .btn-ghost', { hasText: /跳过/ });
    await skipBtn.click();

    // Step 7 (个人数据源)
    await expect(page.locator('#step-7')).toHaveClass(/visible/);

    // Step 7 -> 8 (使用场景)
    await clickPrimaryBtn(page);
    await expect(page.locator('#step-8')).toHaveClass(/visible/);
    await expect(page.locator('#step-8 .h1')).toContainText(/做什么/);

    // Step 8 -> 9 (完成)
    await clickPrimaryBtn(page);
    await expect(page.locator('#step-9')).toHaveClass(/visible/);

    // Finish page should show stats and summary
    await expect(page.locator('#step-9 .tag')).toContainText(/完成/);
    await expect(page.locator('#finish-stats')).toBeVisible();
  });

  // 8. 返回导航保持一致
  test('返回导航 — 从 Step 3 连续返回到 Step 1', async ({ page }) => {
    await gotoOnboarding(page);

    // Advance to step 3
    await clickPrimaryBtn(page); // 2
    await clickPrimaryBtn(page); // 3
    await expect(page.locator('#step-3')).toHaveClass(/visible/);

    // Back to 2
    await clickBackBtn(page);
    await expect(page.locator('#step-2')).toHaveClass(/visible/);

    // Back to 1
    await clickBackBtn(page);
    await expect(page.locator('#step-1')).toHaveClass(/visible/);

    // 全局按钮应恢复为 "开始配置"
    const primaryBtn = page.locator('#global-actions .btn-primary');
    await expect(primaryBtn).toContainText(/开始配置/);
  });

  // 9. 主题切换按钮存在并可交互
  test('主题切换按钮可交互', async ({ page }) => {
    await gotoOnboarding(page);

    const themeBtn = page.locator('#theme-btn');
    await expect(themeBtn).toBeVisible();

    // Click theme button
    await themeBtn.click();

    // data-theme attribute should change on html element
    const theme = await page.locator('html').getAttribute('data-theme');
    expect(theme).toBeTruthy();
  });

  // 10. Step 6 工作方式 — 填写并保存
  test('Step 6 工作方式 — 示例填充 + 保存', async ({ page }) => {
    let workstyleSaved = false;
    let savedContent = '';

    await gotoOnboarding(page);

    // 在 gotoOnboarding（含 mockAllRoutes）之后注册路由，确保此 handler 优先级最高
    // Playwright 匹配最后注册的路由
    await page.route('**/api/agent/workstyle', (route: Route) => {
      if (route.request().method() === 'PUT') {
        workstyleSaved = true;
        savedContent = route.request().postDataJSON().content;
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: { content: '' } });
    });

    // Jump to step 6
    await page.evaluate(() => {
      (window as any).token = 'mock-jwt-token';
      (window as any).user = { user_id: 'usr_1', name: 'Test', role: 'admin' };
      (window as any).goStep(6);
    });

    await expect(page.locator('#step-6')).toHaveClass(/visible/);

    // Click the example to fill the textarea
    const exampleDiv = page.locator('#step-6 div[onclick="fillWorkstyleExample()"]');
    await exampleDiv.click();

    // Textarea should be filled
    const textarea = page.locator('#workstyle-input');
    await expect(textarea).not.toHaveValue('');
    const val = await textarea.inputValue();
    expect(val).toContain('简洁直接');

    // Click "保存并继续"
    const saveBtn = page.locator('#global-actions .btn-primary', { hasText: /保存/ });
    await saveBtn.click();

    // Wait for the save and navigation
    await page.waitForTimeout(800);
    expect(workstyleSaved).toBe(true);
    expect(savedContent).toContain('简洁直接');

    // Should have advanced to step 7
    await expect(page.locator('#step-7')).toHaveClass(/visible/);
  });

  // 11. 同一时刻只有一个 step 可见
  test('同一时刻只有一个 step 可见', async ({ page }) => {
    await gotoOnboarding(page);

    // Navigate through several steps
    for (let i = 0; i < 2; i++) {
      await clickPrimaryBtn(page);
      await page.waitForTimeout(200);

      // Count visible steps
      const visibleSteps = page.locator('.step.visible');
      const count = await visibleSteps.count();
      expect(count).toBe(1);
    }
  });
});

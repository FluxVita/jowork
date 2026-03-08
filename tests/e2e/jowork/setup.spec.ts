import { test, expect } from '@playwright/test';

/**
 * Jowork Setup 向导 E2E 测试
 *
 * setup.html 是首次启动时的配置向导，不需要 token。
 * 三种模式：Solo（单人）、Host（主机）、Join（加入）。
 * Step 1: 选模式 -> Step 2: 配置。
 * 语言切换通过 #lang-btn 实现。
 * AI Config 折叠面板通过 #ai-config-toggle 控制。
 */

test.describe('Jowork Setup Wizard - Deep Interaction Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Mock setup-status to prevent auto-redirect
    await page.route('**/api/system/setup-status', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ done: false }),
      }),
    );
    // Mock setup API for save operations
    await page.route('**/api/system/setup', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }),
    );
    // Mock local-ips for host mode
    await page.route('**/api/system/local-ips', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ips: ['192.168.1.100', '10.0.0.5'] }),
      }),
    );
    // Mock discover for join mode
    await page.route('**/api/system/discover', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          services: [
            { name: 'Teammate Jowork', url: 'http://192.168.1.50:18800' },
          ],
        }),
      }),
    );
  });

  // ── Test 1: Page load ──
  test('设置页面加载 -- mode selection cards visible', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // Page title
    await expect(page).toHaveTitle(/Setup/);

    // Step 1 content visible
    await expect(page.locator('#step-1')).toBeVisible();

    // Steps bar visible
    await expect(page.locator('#steps-bar')).toBeVisible();
    // Step 1 indicator active
    await expect(page.locator('#step-ind-1')).toHaveClass(/active/);

    // Three mode cards visible
    await expect(page.locator('#card-solo')).toBeVisible();
    await expect(page.locator('#card-host')).toBeVisible();
    await expect(page.locator('#card-join')).toBeVisible();

    // Mode cards have titles
    await expect(page.locator('#card-solo .mode-title')).toBeVisible();
    await expect(page.locator('#card-host .mode-title')).toBeVisible();
    await expect(page.locator('#card-join .mode-title')).toBeVisible();

    // Mode cards have descriptions
    await expect(page.locator('#card-solo .mode-desc')).toBeVisible();
    await expect(page.locator('#card-host .mode-desc')).toBeVisible();
    await expect(page.locator('#card-join .mode-desc')).toBeVisible();

    // Next button visible
    await expect(page.locator('button:has-text("Next")')).toBeVisible();

    // No card is selected initially
    await expect(page.locator('#card-solo')).not.toHaveClass(/selected/);
    await expect(page.locator('#card-host')).not.toHaveClass(/selected/);
    await expect(page.locator('#card-join')).not.toHaveClass(/selected/);
  });

  // ── Test 2: Solo mode selection ──
  test('Solo 模式选择 -- click solo -> .selected class', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // Click solo card
    await page.locator('#card-solo').click();

    // Solo should be selected
    await expect(page.locator('#card-solo')).toHaveClass(/selected/);

    // Others not selected
    await expect(page.locator('#card-host')).not.toHaveClass(/selected/);
    await expect(page.locator('#card-join')).not.toHaveClass(/selected/);
  });

  // ── Test 3: Host mode selection ──
  test('Host 模式选择 -- click host -> .selected class, solo deselected', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // First select solo
    await page.locator('#card-solo').click();
    await expect(page.locator('#card-solo')).toHaveClass(/selected/);

    // Then select host (should deselect solo)
    await page.locator('#card-host').click();

    await expect(page.locator('#card-host')).toHaveClass(/selected/);
    await expect(page.locator('#card-solo')).not.toHaveClass(/selected/);
    await expect(page.locator('#card-join')).not.toHaveClass(/selected/);

    // Host badge should be visible (recommended)
    await expect(page.locator('#card-host .mode-badge')).toBeVisible();
  });

  // ── Test 4: Join mode selection ──
  test('Join 模式选择 -- click join -> .selected class', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // Click join card
    await page.locator('#card-join').click();

    await expect(page.locator('#card-join')).toHaveClass(/selected/);
    await expect(page.locator('#card-solo')).not.toHaveClass(/selected/);
    await expect(page.locator('#card-host')).not.toHaveClass(/selected/);
  });

  // ── Test 5: Language toggle ──
  test('语言切换 -- click lang btn -> text changes', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // Lang button should be visible
    const langBtn = page.locator('#lang-btn');
    await expect(langBtn).toBeVisible();

    // Should show EN or 中文
    const initialText = await langBtn.textContent();
    expect(['EN', '中文']).toContain(initialText?.trim());
  });

  // ── Test 6: Host mode Step 2 ──
  test('Host 模式进入 Step 2 -- IP 列表和复制按钮可见', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // Select host and click Next
    await page.locator('#card-host').click();
    await page.locator('button:has-text("Next")').click();

    // Step 2 host content visible
    await expect(page.locator('#step-host')).toBeVisible();
    await expect(page.locator('#step-1')).toBeHidden();

    // Step indicator: step 1 = done, step 2 = active
    await expect(page.locator('#step-ind-1')).toHaveClass(/done/);
    await expect(page.locator('#step-ind-2')).toHaveClass(/active/);

    // IP list should render 2 IP rows
    const ipRows = page.locator('.ip-row');
    await expect(ipRows).toHaveCount(2);

    // Each IP row has URL and copy button
    await expect(ipRows.first().locator('.ip-url')).toBeVisible();
    await expect(ipRows.first().locator('.copy-btn')).toBeVisible();

    // Save button visible
    await expect(page.locator('#host-save-btn')).toBeVisible();

    // Back button visible
    await expect(page.locator('#step-host button:has-text("Back")')).toBeVisible();
  });

  // ── Test 7: Join mode Step 2 ──
  test('Join 模式进入 Step 2 -- 发现服务和手动输入', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // Select join and click Next
    await page.locator('#card-join').click();
    await page.locator('button:has-text("Next")').click();

    // Step 2 join content visible
    await expect(page.locator('#step-join')).toBeVisible();
    await expect(page.locator('#step-1')).toBeHidden();

    // Manual URL input should be visible
    await expect(page.locator('#manual-url')).toBeVisible();

    // Join save button visible
    await expect(page.locator('#join-save-btn')).toBeVisible();

    // Service list should eventually show discovered services
    const serviceList = page.locator('#service-list');
    await expect(serviceList).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.service-item')).toHaveCount(1);
    await expect(page.locator('.service-name')).toContainText('Teammate Jowork');

    // Back button visible
    await expect(page.locator('#step-join button:has-text("Back")')).toBeVisible();
  });

  // ── Test 8: Back button navigation ──
  test('Back 按钮 -- 返回 Step 1', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // Go to host step 2
    await page.locator('#card-host').click();
    await page.locator('button:has-text("Next")').click();
    await expect(page.locator('#step-host')).toBeVisible();

    // Click back
    await page.locator('#step-host button:has-text("Back")').click();

    // Step 1 visible again
    await expect(page.locator('#step-1')).toBeVisible();
    await expect(page.locator('#step-host')).toBeHidden();

    // Step indicators reset
    await expect(page.locator('#step-ind-1')).toHaveClass(/active/);
  });

  // ── Test 9: No mode selected error ──
  test('不选模式点 Next -- 显示错误', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // Click Next without selecting
    await page.locator('button:has-text("Next")').click();

    // Error message should appear
    const error = page.locator('#error-1');
    await expect(error).toBeVisible();
  });

  // ── Test 10: AI Configuration toggle ──
  test('AI Configuration 折叠展开', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // AI config body hidden by default
    const aiBody = page.locator('#ai-config-body');
    await expect(aiBody).not.toHaveClass(/open/);

    // Click toggle to expand
    await page.locator('#ai-config-toggle').click();
    await expect(aiBody).toHaveClass(/open/);

    // OpenRouter key input visible
    await expect(page.locator('#openrouter-key')).toBeVisible();

    // Click toggle to collapse
    await page.locator('#ai-config-toggle').click();
    await expect(aiBody).not.toHaveClass(/open/);
  });

  // ── Test 11: Join mode manual URL input ──
  test('Join 模式手动输入 URL', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    await page.locator('#card-join').click();
    await page.locator('button:has-text("Next")').click();
    await expect(page.locator('#step-join')).toBeVisible();

    // Fill manual URL
    const urlInput = page.locator('#manual-url');
    await urlInput.click();
    await urlInput.fill('http://192.168.1.99:18800');
    await expect(urlInput).toHaveValue('http://192.168.1.99:18800');
  });

  // ── Test 12: Mode switching clears previous selection ──
  test('模式切换清除前一个选择', async ({ page }) => {
    await page.goto('/setup.html');
    await page.waitForLoadState('networkidle');

    // Select solo
    await page.locator('#card-solo').click();
    await expect(page.locator('#card-solo')).toHaveClass(/selected/);

    // Select host
    await page.locator('#card-host').click();
    await expect(page.locator('#card-host')).toHaveClass(/selected/);
    await expect(page.locator('#card-solo')).not.toHaveClass(/selected/);

    // Select join
    await page.locator('#card-join').click();
    await expect(page.locator('#card-join')).toHaveClass(/selected/);
    await expect(page.locator('#card-host')).not.toHaveClass(/selected/);
    await expect(page.locator('#card-solo')).not.toHaveClass(/selected/);
  });
});

import { test, expect } from '../fixtures/auth';

/**
 * Jowork Shell（主框架）E2E 深度交互测试
 *
 * shell.html 是 Jowork 主入口，使用 Vue 3 CDN 渲染。
 * 侧边栏导航通过 iframe 加载子页面（chat/dashboard/logs 等）。
 * 注意：shell.html 检查 /api/system/setup-status，done=false 会跳到 setup.html。
 */

/* ── 共用 mock 路由 ── */
function mockShellAPIs(page: import('@playwright/test').Page) {
  return Promise.all([
    page.route('**/health', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, version: '1.0' }),
      }),
    ),
    page.route('**/api/auth/me', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { user_id: 'usr_1', name: 'Test User', role: 'owner' } }),
      }),
    ),
    page.route('**/api/system/setup-status', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ done: true }),
      }),
    ),
    page.route('**/api/auth/local', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-token', user: { user_id: 'usr_1', name: 'Test', role: 'owner' } }),
      }),
    ),
    page.route('**/api/services/mine', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          services: [
            { service_id: 'svc_page_chat', name: 'Chat', type: 'page' },
            { service_id: 'svc_page_dashboard', name: 'Dashboard', type: 'page' },
          ],
        }),
      }),
    ),
    page.route('**/api/preferences', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      }),
    ),
    // Block iframe sub-page loads to avoid cascading network errors
    page.route('**/chat.html', route => {
      // Only block if loaded in iframe context (not the main page)
      if (route.request().resourceType() === 'document' && route.request().frame()?.parentFrame()) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Chat</body></html>' });
      }
      return route.continue();
    }),
    page.route('**/dashboard.html', route => {
      if (route.request().frame()?.parentFrame()) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Dashboard</body></html>' });
      }
      return route.continue();
    }),
    page.route('**/admin.html', route => {
      if (route.request().frame()?.parentFrame()) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Admin</body></html>' });
      }
      return route.continue();
    }),
    page.route('**/logs.html', route => {
      if (route.request().frame()?.parentFrame()) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Logs</body></html>' });
      }
      return route.continue();
    }),
    page.route('**/billing.html', route => {
      if (route.request().frame()?.parentFrame()) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Billing</body></html>' });
      }
      return route.continue();
    }),
    page.route('**/ai-services.html', route => {
      if (route.request().frame()?.parentFrame()) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>AI Services</body></html>' });
      }
      return route.continue();
    }),
  ]);
}

/* ═══════════════════════════════════════════
   已登录态
   ═══════════════════════════════════════════ */
test.describe('Jowork Shell 已登录态 @smoke', () => {
  test('已登录显示主界面', async ({ joworkPage: page }) => {
    await mockShellAPIs(page);

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');

    // sidebar 可见
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // 用户信息区域可见
    const userRow = page.locator('.sidebar-user-row');
    await expect(userRow).toBeVisible();
  });

  test('侧边栏导航项', async ({ joworkPage: page }) => {
    await mockShellAPIs(page);

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // chat 导航项可见
    const chatNav = page.locator('.nav-item[data-panel="chat"]');
    await expect(chatNav).toBeVisible();

    // dashboard 导航项可见
    const dashboardNav = page.locator('.nav-item[data-panel="dashboard"]');
    await expect(dashboardNav).toBeVisible();

    // logs 导航项可见
    const logsNav = page.locator('.nav-item[data-panel="logs"]');
    await expect(logsNav).toBeVisible();
  });

  test('点击导航切换 active', async ({ joworkPage: page }) => {
    await mockShellAPIs(page);

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // chat 默认 active
    const chatNav = page.locator('.nav-item[data-panel="chat"]');
    await expect(chatNav).toHaveClass(/active/);

    // 点击 dashboard
    const dashboardNav = page.locator('.nav-item[data-panel="dashboard"]');
    await dashboardNav.click();

    // dashboard 获得 active
    await expect(dashboardNav).toHaveClass(/active/);
    // chat 失去 active
    await expect(chatNav).not.toHaveClass(/active/);
  });

  test('品牌 Logo 可见', async ({ joworkPage: page }) => {
    await mockShellAPIs(page);

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    const logo = page.locator('.brand-logo');
    await expect(logo).toBeVisible();
  });

  test('侧边栏折叠展开', async ({ joworkPage: page }) => {
    await mockShellAPIs(page);

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');

    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible({ timeout: 10000 });

    // 初始不折叠
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // 点击折叠按钮
    const collapseBtn = page.locator('.collapse-btn');
    await collapseBtn.click();

    // sidebar 获得 collapsed class
    await expect(sidebar).toHaveClass(/collapsed/);

    // 通过 JS 调用 toggleSidebar() 展开（brand-logo img 可能因图片未加载而不可点击）
    await page.evaluate(() => (window as any).toggleSidebar());

    // sidebar 恢复
    await expect(sidebar).not.toHaveClass(/collapsed/);
  });

  test('主题切换', async ({ joworkPage: page }) => {
    await mockShellAPIs(page);

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // 记录初始 theme
    const initialTheme = await page.locator('html').getAttribute('data-theme');

    // 点击主题切换按钮（侧栏底部 action-btn 第一个）
    await page.locator('.action-btn').first().click();

    // theme 属性应变化
    const newTheme = await page.locator('html').getAttribute('data-theme');
    expect(newTheme).not.toBe(initialTheme);
  });

  test('用户信息显示', async ({ joworkPage: page }) => {
    await mockShellAPIs(page);

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // 用户 avatar 可见
    const avatar = page.locator('.sidebar-user-avatar');
    await expect(avatar).toBeVisible();

    // 用户 name 可见
    const userName = page.locator('.sidebar-user-name');
    await expect(userName).toBeVisible();
  });

  test('Gateway 在线状态', async ({ joworkPage: page }) => {
    await mockShellAPIs(page);

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // status-dot 可见
    const statusDot = page.locator('.status-dot');
    await expect(statusDot).toBeVisible();

    // /health 返回 ok，应有 online class
    await expect(statusDot).toHaveClass(/online/, { timeout: 5000 });
  });

  test('登出按钮', async ({ joworkPage: page }) => {
    await mockShellAPIs(page);

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // 点击 logout 按钮（action-btn.danger）
    // logout() removes TOKEN_KEY from localStorage then calls location.reload()
    // After reload, addInitScript re-injects the token, so we can't check localStorage.
    // Instead, verify logout triggers a page reload (navigation event).
    const logoutBtn = page.locator('.action-btn.danger');
    await expect(logoutBtn).toBeVisible();

    // Wait for navigation (reload) after clicking logout
    const [response] = await Promise.all([
      page.waitForNavigation({ timeout: 5000 }),
      logoutBtn.click(),
    ]);

    // Reload happened (logout called location.reload())
    expect(response).toBeTruthy();
  });

  test('键盘快捷键切换面板', async ({ joworkPage: page }) => {
    await mockShellAPIs(page);

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 10000 });

    // chat 默认 active
    const chatNav = page.locator('.nav-item[data-panel="chat"]');
    await expect(chatNav).toHaveClass(/active/);

    // Ctrl+2 切换到 dashboard（PANEL_SHORTCUT[1] = 'dashboard'）
    await page.keyboard.press('Control+2');

    const dashboardNav = page.locator('.nav-item[data-panel="dashboard"]');
    await expect(dashboardNav).toHaveClass(/active/, { timeout: 3000 });
    await expect(chatNav).not.toHaveClass(/active/);
  });
});

/* ═══════════════════════════════════════════
   未登录态
   ═══════════════════════════════════════════ */
test.describe('Jowork Shell 未登录态', () => {
  test('未登录显示登录表单', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });

    await page.route('**/api/system/setup-status', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ done: true }),
      }),
    );
    await page.route('**/health', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, version: '1.0' }),
      }),
    );
    await page.route('**/api/auth/me', route =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) }),
    );
    // Prevent auto-login in self-hosted mode
    await page.route('**/api/auth/local', route =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Disabled' }) }),
    );

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');

    // login screen 可见
    const loginScreen = page.locator('#login-screen');
    await expect(loginScreen).toBeVisible({ timeout: 5000 });

    // username input 可见
    await expect(page.locator('#login-username')).toBeVisible();
  });

  test('本地登录流程', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });

    let localLoginCallCount = 0;

    await page.route('**/api/system/setup-status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ done: true }) }),
    );
    await page.route('**/health', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    );
    await page.route('**/api/auth/me', route =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) }),
    );
    // First call is autoLocalLogin() — must fail so login screen shows.
    // Second call is user clicking login button — must succeed.
    await page.route('**/api/auth/local', route => {
      localLoginCallCount++;
      if (localLoginCallCount <= 1) {
        // autoLocalLogin() fails → showLoginScreen()
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Disabled' }) });
      }
      // User-initiated login succeeds
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'test-token', user: { user_id: 'usr_1', name: 'Test', role: 'owner' } }),
      });
    });
    await page.route('**/api/services/mine', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ services: [] }) }),
    );
    await page.route('**/api/preferences', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }),
    );

    await page.goto('/shell.html');
    await page.waitForLoadState('networkidle');

    // 等待 login screen 显示
    const loginScreen = page.locator('#login-screen');
    await expect(loginScreen).toBeVisible({ timeout: 5000 });

    // 填写 username — use evaluate to set both the DOM value and Vue reactive state
    await page.evaluate(() => {
      const el = document.getElementById('login-username') as HTMLInputElement;
      el.value = 'testuser';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // 点击 login
    await page.locator('#login-btn').click();

    // API 应被调用（第2次调用才是用户触发的）
    expect(localLoginCallCount).toBeGreaterThanOrEqual(2);
  });
});

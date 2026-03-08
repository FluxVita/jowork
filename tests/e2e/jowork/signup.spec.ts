import { test, expect } from '@playwright/test';

/**
 * Jowork Signup/Login 页面 E2E 深度交互测试
 *
 * signup.html 提供注册和登录两个视图（#signup-view / #login-view）。
 * 已有 jowork_token 时自动跳转 shell.html。
 * 支持 URL 参数：?login（切换登录视图）、?error=xxx（显示错误）。
 */

/* ── 共用 mock ── */
function mockSignupAPIs(page: import('@playwright/test').Page) {
  return Promise.all([
    page.route('**/api/auth/google/status', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enabled: true }),
      }),
    ),
    page.route('**/api/auth/signup', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'new-token', user: { user_id: 'usr_new', name: 'New User' } }),
      }),
    ),
    page.route('**/api/auth/email-login', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'login-token', user: { user_id: 'usr_1', name: 'Test' } }),
      }),
    ),
  ]);
}

test.describe('Jowork Signup 页面', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });
  });

  test('注册页面加载', async ({ page }) => {
    await mockSignupAPIs(page);

    await page.goto('/signup.html');
    await page.waitForLoadState('networkidle');

    // signup-view 可见
    await expect(page.locator('#signup-view')).toBeVisible();

    // 表单字段可见
    await expect(page.locator('#su-name')).toBeVisible();
    await expect(page.locator('#su-email')).toBeVisible();
    await expect(page.locator('#su-password')).toBeVisible();
    await expect(page.locator('#su-btn')).toBeVisible();
  });

  test('切换到登录视图', async ({ page }) => {
    await mockSignupAPIs(page);

    await page.goto('/signup.html');
    await page.waitForLoadState('networkidle');

    // 初始是注册视图
    await expect(page.locator('#signup-view')).toBeVisible();

    // 点击 "Sign in" 链接
    await page.locator('#signup-view .toggle a').click();

    // 登录视图可见，注册视图隐藏
    await expect(page.locator('#login-view')).toBeVisible();
    await expect(page.locator('#signup-view')).toBeHidden();

    // 登录表单字段可见
    await expect(page.locator('#li-email')).toBeVisible();
    await expect(page.locator('#li-password')).toBeVisible();
    await expect(page.locator('#li-btn')).toBeVisible();
  });

  test('切换回注册视图', async ({ page }) => {
    await mockSignupAPIs(page);

    await page.goto('/signup.html');
    await page.waitForLoadState('networkidle');

    // 先切到登录
    await page.locator('#signup-view .toggle a').click();
    await expect(page.locator('#login-view')).toBeVisible();

    // 点击 "Sign up" 链接
    await page.locator('#login-view .toggle a').click();

    // 注册视图回来
    await expect(page.locator('#signup-view')).toBeVisible();
    await expect(page.locator('#login-view')).toBeHidden();
  });

  test('?login 参数自动切换', async ({ page }) => {
    await mockSignupAPIs(page);

    await page.goto('/signup.html?login');
    await page.waitForLoadState('networkidle');

    // 直接显示登录视图
    await expect(page.locator('#login-view')).toBeVisible();
    await expect(page.locator('#signup-view')).toBeHidden();
  });

  test('注册表单验证 -- 空字段', async ({ page }) => {
    await mockSignupAPIs(page);

    await page.goto('/signup.html');
    await page.waitForLoadState('networkidle');

    // 不填任何字段，直接提交
    await page.locator('#su-btn').click();

    // 应显示错误提示
    const error = page.locator('#su-error');
    await expect(error).not.toBeEmpty();
    await expect(error).toContainText('required', { ignoreCase: true });
  });

  test('注册表单验证 -- 短密码', async ({ page }) => {
    await mockSignupAPIs(page);

    await page.goto('/signup.html');
    await page.waitForLoadState('networkidle');

    // 填写名字和邮箱，密码太短
    await page.locator('#su-name').fill('Test User');
    await page.locator('#su-email').fill('test@example.com');
    await page.locator('#su-password').fill('abc');

    await page.locator('#su-btn').click();

    // 应显示密码长度错误
    const error = page.locator('#su-error');
    await expect(error).not.toBeEmpty();
    await expect(error).toContainText('8 characters', { ignoreCase: true });
  });

  test('注册表单提交', async ({ page }) => {
    let signupCalled = false;
    await page.route('**/api/auth/google/status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }),
    );
    await page.route('**/api/auth/signup', route => {
      signupCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'new-token', user: { user_id: 'usr_new', name: 'Test User' } }),
      });
    });
    // Mock shell redirect target
    await page.route('**/api/system/setup-status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ done: true }) }),
    );

    await page.goto('/signup.html');
    await page.waitForLoadState('networkidle');

    // 填写完整表单
    await page.locator('#su-name').fill('Test User');
    await page.locator('#su-email').fill('test@example.com');
    await page.locator('#su-password').fill('securepassword123');

    // 提交
    await page.locator('#su-btn').click();

    // API 应被调用
    expect(signupCalled).toBe(true);

    // 应跳转到 shell.html
    await page.waitForURL('**/shell.html', { timeout: 5000 });
  });

  test('登录表单提交', async ({ page }) => {
    let loginCalled = false;
    await page.route('**/api/auth/google/status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }),
    );
    await page.route('**/api/auth/email-login', route => {
      loginCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'login-token', user: { user_id: 'usr_1', name: 'Test' } }),
      });
    });
    await page.route('**/api/system/setup-status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ done: true }) }),
    );

    await page.goto('/signup.html?login');
    await page.waitForLoadState('networkidle');

    // 登录视图应可见
    await expect(page.locator('#login-view')).toBeVisible();

    // 填写登录表单
    await page.locator('#li-email').fill('test@example.com');
    await page.locator('#li-password').fill('mypassword123');

    // 提交
    await page.locator('#li-btn').click();

    // API 应被调用
    expect(loginCalled).toBe(true);

    // 应跳转到 shell.html
    await page.waitForURL('**/shell.html', { timeout: 5000 });
  });

  test('Google OAuth 按钮可见', async ({ page }) => {
    await page.route('**/api/auth/google/status', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ enabled: true }),
      }),
    );

    await page.goto('/signup.html');
    await page.waitForLoadState('networkidle');

    // Google section 可见
    const googleSection = page.locator('#google-section');
    await expect(googleSection).toBeVisible({ timeout: 3000 });

    // Google 按钮可见
    const googleBtn = googleSection.locator('.btn-google');
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toContainText('Google');
  });

  test('已登录时跳转', async ({ page }) => {
    // 注入一个 token
    await page.addInitScript(() => {
      localStorage.setItem('jowork_token', 'fake-token-for-redirect-test');
    });

    await page.route('**/api/auth/google/status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }),
    );
    await page.route('**/api/system/setup-status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ done: true }) }),
    );

    await page.goto('/signup.html');

    // 应跳转到 shell.html
    await page.waitForURL('**/shell.html', { timeout: 5000 });
  });

  test('URL error 参数显示', async ({ page }) => {
    await page.route('**/api/auth/google/status', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false }) }),
    );

    await page.goto('/signup.html?error=Invalid_credentials');
    await page.waitForLoadState('networkidle');

    // error 信息可见
    const errorEl = page.locator('#su-error');
    await expect(errorEl).not.toBeEmpty();
    await expect(errorEl).toContainText('Invalid credentials');
  });
});

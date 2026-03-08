import { test, expect } from '../fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * Jowork Admin 管理后台 E2E 测试
 *
 * admin.html 通过 checkAuth() 调用 /api/auth/me 验证登录。
 * 登录成功后隐藏 #login-page，显示 #app。
 * Tab 通过 data-tab 属性标识，点击切换 .active + 显示对应 #tab-xxx。
 */

/** 设置所有 admin 页面所需的 mock routes */
async function setupAdminMocks(page: Page) {
  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { user_id: 'usr_1', name: 'Admin', role: 'owner' },
      }),
    }),
  );
  await page.route('**/api/auth/feishu-members', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        members: [
          { name: 'Admin', email: 'admin@test.com', role: 'owner', feishu_open_id: 'ou_1', is_active: true, in_system: true, dept_name: '管理层' },
          { name: 'Member', email: 'member@test.com', role: 'member', feishu_open_id: 'ou_2', is_active: true, in_system: true, dept_name: '管理层' },
        ],
        fallback: false,
      }),
    }),
  );
  await page.route('**/api/auth/users', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        users: [
          { user_id: 'usr_1', name: 'Admin', role: 'owner', email: 'admin@test.com', status: 'active', feishu_open_id: 'ou_1', last_active: '2026-03-01' },
          { user_id: 'usr_2', name: 'Member', role: 'member', email: 'member@test.com', status: 'active', feishu_open_id: 'ou_2', last_active: '2026-03-01' },
        ],
      }),
    }),
  );
  await page.route('**/api/groups', route => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ group_id: 'grp_1', name: 'Test Group' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ groups: [] }),
    });
  });
  await page.route('**/api/services**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        services: [
          { service_id: 'svc_1', name: 'Chat', type: 'page', status: 'active', icon: '💬', description: 'AI Chat', default_min_role: 'member', grants_count: 2 },
          { service_id: 'svc_2', name: 'Search', type: 'tool', status: 'active', icon: '🔍', description: 'Data Search', default_min_role: 'member', grants_count: 1 },
        ],
        stats: { total: 2, active: 2, inactive: 0, deprecated: 0 },
      }),
    }),
  );
  await page.route('**/api/connectors**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ connectors: [] }),
    }),
  );
  await page.route('**/api/connectors/health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/connectors/entitlements', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/cron**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: [] }),
    }),
  );
  await page.route('**/health', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, version: '1.0.0', uptime: 3600 }),
    }),
  );
  await page.route('**/api/usage/detail**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [], totals: { tokens_in: 0, tokens_out: 0, cost_usd: 0, requests: 0 } }),
    }),
  );
  await page.route('**/api/tools/stats**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tools: [], summary: { total_calls: 0, success_rate: 100, avg_duration: 0 } }),
    }),
  );
  await page.route('**/api/preferences', route => {
    if (route.request().method() === 'PUT') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ language: 'zh-CN', response_style: 'balanced', timezone: 'Asia/Shanghai' }),
    });
  });
  await page.route('**/api/context/docs**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ docs: [] }),
    }),
  );
  await page.route('**/api/logs/stream**', route =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'log line 1\nlog line 2' }),
  );
  await page.route('**/api/logs/buffer**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lines: ['[INFO] log line 1', '[WARN] log line 2'], total: 2 }),
    }),
  );
  await page.route('**/api/dashboard/overview**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total_objects: 50 }),
    }),
  );
  await page.route('**/api/group-bindings**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ bindings: [] }),
    }),
  );
  await page.route('**/api/billing/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/settings**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/admin/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/system/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }),
  );
  await page.route('**/api/models/providers', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );
  await page.route('**/api/audit/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ logs: [], total: 0 }),
    }),
  );
}

/** Navigate and wait for admin app to be visible */
async function goToAdmin(page: Page) {
  await page.goto('/admin.html');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });
}

test.describe('Jowork Admin - Deep Interaction Tests', () => {

  // ── Test 1: Page load ──
  test('管理后台加载 -- tabs and header visible', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);
    await goToAdmin(page);

    // Header with title
    const header = page.locator('.header');
    await expect(header).toBeVisible();
    await expect(header.locator('h1')).toContainText('Jowork Admin');

    // User info display
    await expect(page.locator('#user-display')).toContainText('Admin');

    // Tabs bar visible
    const tabs = page.locator('.tabs');
    await expect(tabs).toBeVisible();

    // Core tabs present
    const coreTabNames = ['users', 'dataconfig', 'cron', 'system', 'services', 'usage', 'toolstats', 'groups', 'logs', 'context', 'preferences'];
    for (const tabName of coreTabNames) {
      await expect(page.locator(`.tab[data-tab="${tabName}"]`)).toBeAttached();
    }

    // Default tab is users and is active
    await expect(page.locator('.tab[data-tab="users"]')).toHaveClass(/active/);

    // Users tab content is visible by default
    await expect(page.locator('#tab-users')).toBeVisible();
  });

  // ── Test 2: Switch to Users Tab ──
  test('切换到 Users Tab -- click -> active, user table visible', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);
    await goToAdmin(page);

    // Click users tab (should already be active, but click to confirm behavior)
    await page.locator('.tab[data-tab="users"]').click();
    await expect(page.locator('.tab[data-tab="users"]')).toHaveClass(/active/);
    await expect(page.locator('#tab-users')).toBeVisible();

    // User table should have rows from mock data
    const usersBody = page.locator('#users-body');
    await expect(usersBody).toBeVisible();
    // Wait for user data to load
    await expect(usersBody.locator('tr').first()).toBeVisible({ timeout: 5000 });
    // Should contain user names
    await expect(usersBody).toContainText('Admin');

    // Other tabs should be hidden
    await expect(page.locator('#tab-services')).toBeHidden();
    await expect(page.locator('#tab-groups')).toBeHidden();
  });

  // ── Test 3: Switch to Services Tab ──
  test('切换到 Services Tab -- click -> services content visible', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);
    await goToAdmin(page);

    // Click services tab
    await page.locator('.tab[data-tab="services"]').click();

    // Services tab active
    await expect(page.locator('.tab[data-tab="services"]')).toHaveClass(/active/);
    // Users tab no longer active
    await expect(page.locator('.tab[data-tab="users"]')).not.toHaveClass(/active/);

    // Services content visible
    await expect(page.locator('#tab-services')).toBeVisible();
    await expect(page.locator('#tab-users')).toBeHidden();

    // Services table body present
    const svcBody = page.locator('#svc-body');
    await expect(svcBody).toBeAttached();

    // Filter dropdowns visible
    await expect(page.locator('#svc-type-filter')).toBeVisible();
    await expect(page.locator('#svc-status-filter')).toBeVisible();

    // New service button visible
    await expect(page.locator('button:has-text("新服务")')).toBeVisible();
  });

  // ── Test 4: Switch to Groups Tab ──
  test('切换到 Groups Tab -- click -> groups content visible', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);
    await goToAdmin(page);

    // Click groups tab
    await page.locator('.tab[data-tab="groups"]').click();

    await expect(page.locator('.tab[data-tab="groups"]')).toHaveClass(/active/);
    await expect(page.locator('#tab-groups')).toBeVisible();
    await expect(page.locator('#tab-users')).toBeHidden();

    // Create group form elements visible
    await expect(page.locator('#new-group-name')).toBeVisible();
    await expect(page.locator('button:has-text("创建")')).toBeVisible();

    // Groups list container
    await expect(page.locator('#groups-list')).toBeVisible();
  });

  // ── Test 5: Switch to System Tab ──
  test('切换到 System Tab -- click -> system health visible', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);
    await goToAdmin(page);

    // Click system tab
    await page.locator('.tab[data-tab="system"]').click();

    await expect(page.locator('.tab[data-tab="system"]')).toHaveClass(/active/);
    await expect(page.locator('#tab-system')).toBeVisible();

    // System stats grid exists
    await expect(page.locator('#system-stats')).toBeAttached();

    // Refresh button visible
    await expect(page.locator('#tab-system button:has-text("刷新")')).toBeVisible();
  });

  // ── Test 6: Switch to Usage Tab ──
  test('切换到 Usage Tab -- click -> usage stats visible', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);
    await goToAdmin(page);

    // Click usage tab
    await page.locator('.tab[data-tab="usage"]').click();

    await expect(page.locator('.tab[data-tab="usage"]')).toHaveClass(/active/);
    await expect(page.locator('#tab-usage')).toBeVisible();

    // Usage sub-tab buttons exist
    await expect(page.locator('#usage-subtab-detail')).toBeVisible();
    await expect(page.locator('#usage-subtab-accounts')).toBeVisible();
    await expect(page.locator('#usage-subtab-hourly')).toBeVisible();

    // Days filter exists
    await expect(page.locator('#usage-days')).toBeVisible();
  });

  // ── Test 7: Switch to Preferences Tab ──
  test('切换到 Preferences Tab -- click -> preference selects visible', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);
    await goToAdmin(page);

    // Click preferences tab
    await page.locator('.tab[data-tab="preferences"]').click();

    await expect(page.locator('.tab[data-tab="preferences"]')).toHaveClass(/active/);
    await expect(page.locator('#tab-preferences')).toBeVisible();

    // Language select visible
    await expect(page.locator('#pref-language')).toBeVisible();

    // Response style select visible
    await expect(page.locator('#pref-response-style')).toBeVisible();

    // Timezone select visible
    await expect(page.locator('#pref-timezone')).toBeVisible();

    // Save button visible
    await expect(page.locator('#pref-save-btn')).toBeVisible();
  });

  // ── Test 8: Users refresh ──
  test('Users 刷新 -- click refresh -> API called', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);

    let usersApiCallCount = 0;
    // Override feishu-members route to count calls (loadUsers calls this first)
    await page.route('**/api/auth/feishu-members', route => {
      usersApiCallCount++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          members: [
            { name: 'Admin', email: 'admin@test.com', role: 'owner', feishu_open_id: 'ou_1', is_active: true, in_system: true, dept_name: '管理层' },
          ],
          fallback: false,
        }),
      });
    });

    await goToAdmin(page);

    // Initial load should trigger one call
    const initialCount = usersApiCallCount;
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Click refresh button in users tab toolbar (use data-i18n to avoid locale-dependent text)
    await page.locator('#tab-users .toolbar button[data-i18n="ui.refresh"]').click();

    // Wait for API to be called again
    await page.waitForTimeout(500);
    expect(usersApiCallCount).toBeGreaterThan(initialCount);

    // Table should still show user data
    await expect(page.locator('#users-body')).toContainText('Admin');
  });

  // ── Test 9: Create group ──
  test('创建群组 -- fill name -> click create -> API called', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);

    let groupCreateCalled = false;
    let groupCreatePayload: string | null = null;
    await page.route('**/api/groups', route => {
      if (route.request().method() === 'POST') {
        groupCreateCalled = true;
        groupCreatePayload = route.request().postData();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ group_id: 'grp_1', name: 'Test Group' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ groups: [] }),
      });
    });

    await goToAdmin(page);

    // Navigate to groups tab
    await page.locator('.tab[data-tab="groups"]').click();
    await expect(page.locator('#tab-groups')).toBeVisible();

    // Fill group name
    const nameInput = page.locator('#new-group-name');
    await nameInput.click();
    await nameInput.fill('Test Group');
    await expect(nameInput).toHaveValue('Test Group');

    // Click create button
    await page.locator('#tab-groups button:has-text("创建")').click();

    // Wait for API call
    await page.waitForTimeout(500);
    expect(groupCreateCalled).toBe(true);
    expect(groupCreatePayload).toContain('Test Group');
  });

  // ── Test 10: Services filter ──
  test('Services 筛选 -- change type filter -> table filters', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);

    let lastServicesUrl = '';
    await page.route('**/api/services**', route => {
      lastServicesUrl = route.request().url();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          services: [
            { service_id: 'svc_1', name: 'Chat', type: 'page', status: 'active', icon: '💬', description: 'AI Chat', default_min_role: 'member', grants_count: 2 },
          ],
          stats: { total: 1, active: 1, inactive: 0, deprecated: 0 },
        }),
      });
    });

    await goToAdmin(page);

    // Navigate to services tab
    await page.locator('.tab[data-tab="services"]').click();
    await expect(page.locator('#tab-services')).toBeVisible();

    // Change type filter to "model"
    const typeFilter = page.locator('#svc-type-filter');
    await typeFilter.selectOption('model');

    // Wait for API call
    await page.waitForTimeout(500);

    // The filter value should be "model"
    await expect(typeFilter).toHaveValue('model');

    // Change status filter to "active"
    const statusFilter = page.locator('#svc-status-filter');
    await statusFilter.selectOption('active');
    await page.waitForTimeout(500);
    await expect(statusFilter).toHaveValue('active');

    // New service form toggle: click "+ 新服务" -> form shows
    await page.locator('button:has-text("新服务")').click();
    await expect(page.locator('#new-svc-form')).toBeVisible();

    // Form inputs visible
    await expect(page.locator('#nsvc-id')).toBeVisible();
    await expect(page.locator('#nsvc-name')).toBeVisible();
    await expect(page.locator('#nsvc-type')).toBeVisible();

    // Cancel hides form
    await page.locator('#new-svc-form button:has-text("取消")').click();
    await expect(page.locator('#new-svc-form')).toBeHidden();
  });

  // ── Test 11: Tab rapid switching ──
  test('快速切换多个 Tab -- 每次切换只有一个 tab active', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);
    await goToAdmin(page);

    const tabNames = ['services', 'groups', 'system', 'usage', 'preferences', 'users'];
    for (const tabName of tabNames) {
      await page.locator(`.tab[data-tab="${tabName}"]`).click();
      // Only the clicked tab should be active
      await expect(page.locator(`.tab[data-tab="${tabName}"]`)).toHaveClass(/active/);
      // The tab content should be visible
      await expect(page.locator(`#tab-${tabName}`)).toBeVisible();

      // Verify no other tab-content is visible (check a few key ones)
      for (const otherTab of tabNames) {
        if (otherTab !== tabName) {
          await expect(page.locator(`.tab[data-tab="${otherTab}"]`)).not.toHaveClass(/active/);
        }
      }
    }
  });

  // ── Test 12: Owner-only tabs visible for owner role ──
  test('Owner 角色可以看到 owner-only tabs', async ({ joworkPage: page }) => {
    await setupAdminMocks(page);
    await goToAdmin(page);

    // Owner-only tabs should be visible for owner role
    await expect(page.locator('.tab[data-tab="pricing-engine"]')).toBeVisible();
    await expect(page.locator('.tab[data-tab="billing"]')).toBeVisible();
  });
});

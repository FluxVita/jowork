import { test, expect } from '../fixtures/auth';
import type { Page, Route } from '@playwright/test';

/**
 * FluxVita Admin 管理后台 E2E 测试
 *
 * admin.html 14+ tabs, JWT 认证, owner/admin 角色权限.
 * 所有 API 路由在 page.goto() 之前 mock，验证真实用户交互行为。
 */

// ── Mock 数据 ──

const MOCK_USER = { user_id: 'usr_1', name: 'Admin', role: 'owner', email: 'admin@test.com' };

const MOCK_USERS = [
  { user_id: 'usr_1', name: 'Admin', role: 'owner', email: 'admin@test.com', last_active: '2026-03-07T10:00:00Z', feishu_open_id: 'ou_test1', status: 'active' },
  { user_id: 'usr_2', name: 'Dev', role: 'admin', email: 'dev@test.com', last_active: '2026-03-06T08:00:00Z', feishu_open_id: 'ou_test2', status: 'active' },
];

const MOCK_SERVICES = [
  { service_id: 'svc_chat', name: 'AI Chat', type: 'model', status: 'active', icon: '🤖', description: 'AI Chat Service', default_roles: ['admin'], grant_count: 3 },
  { service_id: 'svc_feishu', name: 'Feishu Connector', type: 'connector', status: 'active', icon: '💬', description: 'Feishu', default_roles: ['member'], grant_count: 1 },
  { service_id: 'svc_old', name: 'Deprecated Tool', type: 'tool', status: 'deprecated', icon: '🔧', description: 'Old', default_roles: [], grant_count: 0 },
];

const MOCK_PREFERENCES = {
  preferences: { language: 'zh-CN', response_style: 'concise', timezone: 'Asia/Shanghai' },
};

const MOCK_CONTEXT_DOCS = [
  { id: 'doc_1', layer: 'company', doc_type: 'manual', scope_id: 'default', title: 'Company Rules', content: 'Be nice.', is_forced: false, updated_at: '2026-03-07T10:00:00Z' },
];

// ── Helper: mock 所有 API 路由 ──

async function mockAllRoutes(page: Page) {
  // Auth
  await page.route('**/api/auth/me', (route: Route) =>
    route.fulfill({ json: { user: MOCK_USER } }));

  await page.route('**/api/auth/users', (route: Route) =>
    route.fulfill({ json: { users: MOCK_USERS } }));

  await page.route('**/api/auth/feishu-members', (route: Route) =>
    route.fulfill({ json: { members: MOCK_USERS.map(u => ({ ...u, in_system: true })), fallback: false } }));

  // Groups
  await page.route('**/api/groups', (route: Route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: { group_id: 'grp_1', name: 'Test Group' } });
    }
    return route.fulfill({ json: { groups: [] } });
  });

  // Services
  await page.route('**/api/services', (route: Route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { services: MOCK_SERVICES } });
  });

  // Usage — loadUsage() calls /api/models/usage?days=...
  await page.route('**/api/models/usage', (route: Route) =>
    route.fulfill({ json: { rows: [], totals: { tokens_in: 0, tokens_out: 0, cost_usd: 0, requests: 0 } } }));

  await page.route('**/api/models/usage/detail**', (route: Route) =>
    route.fulfill({ json: { rows: [], totals: { tokens_in: 0, tokens_out: 0, cost_usd: 0, requests: 0 } } }));

  await page.route('**/api/models/usage/accounts**', (route: Route) =>
    route.fulfill({ json: { totals: { tokens_in: 1000, tokens_out: 500, cost_usd: 0.05, requests: 10 }, accounts: [] } }));

  await page.route('**/api/models/usage/hourly**', (route: Route) =>
    route.fulfill({ json: { hourly: [] } }));

  // Preferences
  await page.route('**/api/preferences', (route: Route) => {
    if (route.request().method() === 'PUT') {
      return route.fulfill({ json: { ok: true, preferences: MOCK_PREFERENCES.preferences } });
    }
    return route.fulfill({ json: MOCK_PREFERENCES });
  });

  // Context docs
  await page.route('**/api/context/docs', (route: Route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ json: { ok: true, doc_id: 'd_new' } });
    }
    return route.fulfill({ json: { docs: MOCK_CONTEXT_DOCS } });
  });

  // Services guard — /api/services/mine
  await page.route('**/api/services/mine', (route: Route) =>
    route.fulfill({ json: { services: MOCK_SERVICES } }));

  // Connectors
  await page.route('**/api/connectors', (route: Route) =>
    route.fulfill({ json: { connectors: [] } }));
  await page.route('**/api/connectors/health', (route: Route) =>
    route.fulfill({ json: {} }));

  // Cron
  await page.route('**/api/cron**', (route: Route) =>
    route.fulfill({ json: { tasks: [] } }));

  // Health
  await page.route('**/health', (route: Route) =>
    route.fulfill({ json: { ok: true, version: '1.0.0', uptime: 3600 } }));

  // Tool stats
  await page.route('**/api/tools/stats**', (route: Route) =>
    route.fulfill({ json: { tools: [], summary: { total_calls: 0 } } }));

  await page.route('**/api/agent/tool-stats**', (route: Route) =>
    route.fulfill({ json: { totals: { calls: 0, successes: 0, errors: 0 }, rows: [], recent: [], daily: [] } }));

  // Settings
  await page.route('**/api/settings/**', (route: Route) =>
    route.fulfill({ json: {} }));

  // Audit logs
  await page.route('**/api/audit/logs**', (route: Route) =>
    route.fulfill({ json: { logs: [] } }));

  // Logs stream
  await page.route('**/api/logs/stream**', (route: Route) =>
    route.fulfill({ body: '', contentType: 'text/plain' }));

  // System / alerts / backups
  await page.route('**/api/system**', (route: Route) =>
    route.fulfill({ json: { uptime: 3600, memory: {}, cpu: {} } }));
  await page.route('**/api/alerts**', (route: Route) =>
    route.fulfill({ json: { alerts: [], history: [] } }));
  await page.route('**/api/backups**', (route: Route) =>
    route.fulfill({ json: { backups: [] } }));

  // Pricing engine
  await page.route('**/api/pricing**', (route: Route) =>
    route.fulfill({ json: { behaviors: [], rates: [] } }));

  // Billing
  await page.route('**/api/billing**', (route: Route) =>
    route.fulfill({ json: { subscriptions: [] } }));

  // AI Models
  await page.route('**/api/ai/models**', (route: Route) =>
    route.fulfill({ json: { models: [] } }));

  // Agent workstyle
  await page.route('**/api/agent/workstyle', (route: Route) =>
    route.fulfill({ json: { content: '' } }));

  // Sync groups
  await page.route('**/api/services/sync-groups', (route: Route) =>
    route.fulfill({ json: { ok: true } }));
}

// ── Helper: go to admin with auth & mocks ──

async function gotoAdmin(page: Page) {
  await mockAllRoutes(page);
  // Inject token into localStorage before navigation
  await page.addInitScript(() => {
    localStorage.setItem('fluxvita_token', 'mock-jwt-token');
    localStorage.setItem('fluxvita_admin_token', 'mock-jwt-token');
    localStorage.setItem('user', JSON.stringify({ user_id: 'usr_1', name: 'Admin', role: 'owner' }));
  });
  await page.goto('/admin.html');
  // Wait for the app to show (checkAuth -> showApp)
  await page.locator('#app:not(.hidden)').waitFor({ timeout: 8000 });
}

// ═══════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════

test.describe('FluxVita Admin @regression', () => {

  // 1. 管理后台加载
  test('管理后台加载 — header + tabs 可见', async ({ page }) => {
    await gotoAdmin(page);

    await expect(page).toHaveTitle(/管理后台|Admin/i);

    const header = page.locator('.header');
    await expect(header).toBeVisible();

    const tabs = page.locator('.tabs');
    await expect(tabs).toBeVisible();

    // 至少显示 users tab 默认 active
    const activeTab = page.locator('.tab.active');
    await expect(activeTab).toBeVisible();
    await expect(activeTab).toHaveAttribute('data-tab', 'users');

    // 用户名显示
    const userDisplay = page.locator('#user-display');
    await expect(userDisplay).toContainText('Admin');
  });

  // 2. Tab 导航 — 切换 Users
  test('Tab 导航 — 切换 Users', async ({ page }) => {
    await gotoAdmin(page);

    const usersTab = page.locator('.tab[data-tab="users"]');
    await usersTab.click();

    await expect(usersTab).toHaveClass(/active/);

    const usersContent = page.locator('#tab-users');
    await expect(usersContent).not.toHaveClass(/hidden/);
  });

  // 3. Tab 导航 — 切换 Services
  test('Tab 导航 — 切换 Services', async ({ page }) => {
    await gotoAdmin(page);

    const servicesTab = page.locator('.tab[data-tab="services"]');
    await servicesTab.click();

    await expect(servicesTab).toHaveClass(/active/);

    const servicesContent = page.locator('#tab-services');
    await expect(servicesContent).not.toHaveClass(/hidden/);

    // Users tab should now be hidden
    const usersContent = page.locator('#tab-users');
    await expect(usersContent).toHaveClass(/hidden/);
  });

  // 4. Tab 导航 — 切换 Groups
  test('Tab 导航 — 切换 Groups', async ({ page }) => {
    await gotoAdmin(page);

    const groupsTab = page.locator('.tab[data-tab="groups"]');
    await groupsTab.click();

    await expect(groupsTab).toHaveClass(/active/);

    const groupsContent = page.locator('#tab-groups');
    await expect(groupsContent).not.toHaveClass(/hidden/);
  });

  // 5. Tab 导航 — 切换 Usage
  test('Tab 导航 — 切换 Usage', async ({ page }) => {
    await gotoAdmin(page);

    const usageTab = page.locator('.tab[data-tab="usage"]');
    await usageTab.click();

    await expect(usageTab).toHaveClass(/active/);

    const usageContent = page.locator('#tab-usage');
    await expect(usageContent).not.toHaveClass(/hidden/);
  });

  // 6. Tab 导航 — 切换 Preferences
  test('Tab 导航 — 切换 Preferences', async ({ page }) => {
    await gotoAdmin(page);

    const prefTab = page.locator('.tab[data-tab="preferences"]');
    await prefTab.click();

    await expect(prefTab).toHaveClass(/active/);

    const prefContent = page.locator('#tab-preferences');
    await expect(prefContent).not.toHaveClass(/hidden/);
  });

  // 7. Tab 导航 — 切换 Context
  test('Tab 导航 — 切换 Context', async ({ page }) => {
    await gotoAdmin(page);

    const ctxTab = page.locator('.tab[data-tab="context"]');
    await ctxTab.click();

    await expect(ctxTab).toHaveClass(/active/);

    const ctxContent = page.locator('#tab-context');
    await expect(ctxContent).not.toHaveClass(/hidden/);
  });

  // 8. Users 刷新按钮
  test('Users 刷新按钮 — API 调用 + 表格填充', async ({ page }) => {
    let usersFetched = 0;

    await gotoAdmin(page);

    // Override the feishu-members route AFTER gotoAdmin so it takes priority
    await page.route('**/api/auth/feishu-members', (route: Route) => {
      usersFetched++;
      return route.fulfill({
        json: {
          members: MOCK_USERS.map(u => ({ ...u, in_system: true })),
          fallback: false,
        },
      });
    });

    // Wait for initial loadUsers() to complete (called by showApp)
    // loadUsers renders: 1 header note row + 1 dept group row + N user rows
    // With 2 users in same dept ("未分配"), total = 1 + 1 + 2 = 4 rows
    const tbody = page.locator('#users-body');
    await expect(tbody.locator('tr')).toHaveCount(4, { timeout: 5000 });

    // Now click refresh — this will use our overridden route
    const refreshBtn = page.locator('#tab-users button', { hasText: /刷新|Refresh/i });
    await refreshBtn.click();

    // Verify our custom route was called (at least once for the refresh)
    await page.waitForTimeout(300);
    expect(usersFetched).toBeGreaterThanOrEqual(1);

    // Table should still show 4 rows (header + dept + 2 users)
    await expect(tbody.locator('tr')).toHaveCount(4);

    // Verify user data in rows — "Admin" should appear in one of the user rows
    await expect(tbody).toContainText('Admin');
  });

  // 9. Groups 创建群组
  test('Groups 创建群组 — 填写名称 + 提交', async ({ page }) => {
    let createCalled = false;
    let createBody: Record<string, unknown> = {};

    await gotoAdmin(page);

    // Override the groups route AFTER gotoAdmin so it takes priority
    await page.route('**/api/groups', (route: Route) => {
      if (route.request().method() === 'POST') {
        createCalled = true;
        const postData = route.request().postDataJSON();
        createBody = postData;
        return route.fulfill({ json: { group_id: 'grp_1', name: postData.name } });
      }
      return route.fulfill({ json: { groups: [] } });
    });

    // Switch to groups tab
    await page.locator('.tab[data-tab="groups"]').click();
    await expect(page.locator('#tab-groups')).not.toHaveClass(/hidden/);

    // Fill group name
    const nameInput = page.locator('#new-group-name');
    await nameInput.fill('Engineering Team');

    // Click create
    const createBtn = page.locator('#tab-groups button', { hasText: /创建|Create/i });
    await createBtn.click();

    // Verify API was called with correct body
    await page.waitForTimeout(300);
    expect(createCalled).toBe(true);
    expect(createBody.name).toBe('Engineering Team');

    // Input should be cleared after successful creation
    await expect(nameInput).toHaveValue('');
  });

  // 10. Services 新服务表单显示隐藏
  test('Services 新服务表单显示隐藏', async ({ page }) => {
    await gotoAdmin(page);

    // Switch to services tab
    await page.locator('.tab[data-tab="services"]').click();
    await expect(page.locator('#tab-services')).not.toHaveClass(/hidden/);

    // Form initially hidden
    const form = page.locator('#new-svc-form');
    await expect(form).toHaveClass(/hidden/);

    // Click "+ 新服务" button
    const newBtn = page.locator('#tab-services button', { hasText: /新服务/ });
    await newBtn.click();

    // Form should be visible
    await expect(form).not.toHaveClass(/hidden/);

    // Click cancel
    const cancelBtn = form.locator('button', { hasText: /取消|Cancel/ });
    await cancelBtn.click();

    // Form should be hidden again
    await expect(form).toHaveClass(/hidden/);
  });

  // 11. Services 创建服务
  test('Services 创建服务 — 填表单 + 提交', async ({ page }) => {
    let createCalled = false;
    let createPayload: Record<string, unknown> = {};

    await gotoAdmin(page);

    // Override the services route AFTER gotoAdmin so it takes priority
    await page.route('**/api/services', (route: Route) => {
      if (route.request().method() === 'POST') {
        createCalled = true;
        createPayload = route.request().postDataJSON();
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: { services: MOCK_SERVICES } });
    });

    // Switch to services tab
    await page.locator('.tab[data-tab="services"]').click();

    // Open form
    await page.locator('#tab-services button', { hasText: /新服务/ }).click();

    const form = page.locator('#new-svc-form');
    await expect(form).not.toHaveClass(/hidden/);

    // Fill all fields
    await page.locator('#nsvc-id').fill('svc_test_new');
    await page.locator('#nsvc-name').fill('Test Service');
    await page.locator('#nsvc-type').selectOption('tool');
    await page.locator('#nsvc-icon').fill('🧪');
    await page.locator('#nsvc-desc').fill('A test service for E2E');

    // Click register
    const registerBtn = form.locator('button', { hasText: /注册/ });
    await registerBtn.click();

    await page.waitForTimeout(300);
    expect(createCalled).toBe(true);
    expect(createPayload.service_id).toBe('svc_test_new');
    expect(createPayload.name).toBe('Test Service');
    expect(createPayload.type).toBe('tool');

    // Form should be hidden after success
    await expect(form).toHaveClass(/hidden/);
  });

  // 12. Services 类型筛选
  test('Services 类型筛选 — 改变筛选触发 API', async ({ page }) => {
    let lastUrl = '';

    await page.route('**/api/services**', (route: Route) => {
      if (route.request().method() === 'GET') {
        lastUrl = route.request().url();
        return route.fulfill({ json: { services: MOCK_SERVICES } });
      }
      return route.fulfill({ json: { ok: true } });
    });

    await gotoAdmin(page);

    // Switch to services tab
    await page.locator('.tab[data-tab="services"]').click();
    await page.waitForTimeout(500);

    // Change type filter to 'connector'
    await page.locator('#svc-type-filter').selectOption('connector');

    await page.waitForTimeout(500);
    expect(lastUrl).toContain('type=connector');

    // Change status filter to 'active'
    await page.locator('#svc-status-filter').selectOption('active');

    await page.waitForTimeout(500);
    expect(lastUrl).toContain('status=active');
  });

  // 13. Usage 子 Tab 切换
  test('Usage 子 Tab 切换 — detail/accounts/hourly', async ({ page }) => {
    await gotoAdmin(page);

    // Switch to usage tab
    await page.locator('.tab[data-tab="usage"]').click();
    await expect(page.locator('#tab-usage')).not.toHaveClass(/hidden/);

    // Detail subtab should be visible by default
    const detailDiv = page.locator('#usage-sub-detail');
    await expect(detailDiv).toBeVisible();

    // Click accounts subtab
    const accountsBtn = page.locator('#usage-subtab-accounts');
    await accountsBtn.click();

    // Accounts view should show, detail should hide
    const accountsDiv = page.locator('#usage-sub-accounts');
    await expect(accountsDiv).toBeVisible();
    await expect(detailDiv).toBeHidden();

    // Click hourly subtab
    const hourlyBtn = page.locator('#usage-subtab-hourly');
    await hourlyBtn.click();

    const hourlyDiv = page.locator('#usage-sub-hourly');
    await expect(hourlyDiv).toBeVisible();
    await expect(accountsDiv).toBeHidden();

    // Click back to detail
    const detailBtn = page.locator('#usage-subtab-detail');
    await detailBtn.click();

    await expect(detailDiv).toBeVisible();
    await expect(hourlyDiv).toBeHidden();
  });

  // 14. Usage 日期筛选
  test('Usage 日期筛选 — 切换天数触发 API', async ({ page }) => {
    await gotoAdmin(page);

    // Switch to usage tab — this triggers loadUsage()
    await page.locator('.tab[data-tab="usage"]').click();
    await page.waitForTimeout(500);

    // Change days filter from 30 to 7 — this calls loadUsage() again via onchange
    const responsePromise = page.waitForRequest((req) => req.url().includes('/api/models/usage') && !req.url().includes('/usage/'));
    await page.locator('#usage-days').selectOption('7');
    const req = await responsePromise;

    // Verify the request was made with the new days parameter
    expect(req.url()).toContain('days=7');
  });

  // 15. Preferences 保存
  test('Preferences 保存 — 修改值 + 提交 + 状态反馈', async ({ page }) => {
    let saveCalled = false;
    let savePayload: Record<string, unknown> = {};

    await gotoAdmin(page);

    // Override preferences route AFTER gotoAdmin so it takes priority
    await page.route('**/api/preferences', (route: Route) => {
      if (route.request().method() === 'PUT') {
        saveCalled = true;
        savePayload = route.request().postDataJSON();
        return route.fulfill({ json: { ok: true, preferences: savePayload } });
      }
      return route.fulfill({ json: MOCK_PREFERENCES });
    });

    // Switch to preferences tab
    await page.locator('.tab[data-tab="preferences"]').click();
    await expect(page.locator('#tab-preferences')).not.toHaveClass(/hidden/);

    // Wait for preferences to load
    await page.waitForTimeout(500);

    // Change language to English
    await page.locator('#pref-language').selectOption('en');

    // Change response style to detailed
    await page.locator('#pref-response-style').selectOption('detailed');

    // Change timezone
    await page.locator('#pref-timezone').selectOption('America/New_York');

    // Click save
    const saveBtn = page.locator('#pref-save-btn');
    await saveBtn.click();

    await page.waitForTimeout(500);
    expect(saveCalled).toBe(true);
    expect(savePayload.language).toBe('en');
    expect(savePayload.response_style).toBe('detailed');
    expect(savePayload.timezone).toBe('America/New_York');

    // Status should show success
    const status = page.locator('#pref-status');
    await expect(status).toContainText(/已保存|saved/i);
  });

  // 16. Context 创建文档
  test('Context 创建文档 — 打开模态框 + 填写 + 保存', async ({ page }) => {
    let postCalled = false;
    let postBody: Record<string, unknown> = {};

    await gotoAdmin(page);

    // Override context docs route AFTER gotoAdmin so it takes priority
    await page.route('**/api/context/docs', (route: Route) => {
      if (route.request().method() === 'POST') {
        postCalled = true;
        postBody = route.request().postDataJSON();
        return route.fulfill({ json: { ok: true, doc_id: 'd_new' } });
      }
      return route.fulfill({ json: { docs: MOCK_CONTEXT_DOCS } });
    });

    // Switch to context tab
    await page.locator('.tab[data-tab="context"]').click();
    await expect(page.locator('#tab-context')).not.toHaveClass(/hidden/);

    // Modal should be hidden initially
    const modal = page.locator('#ctx-modal');
    await expect(modal).toBeHidden();

    // Click "+ 新建文档"
    const createBtn = page.locator('#tab-context button', { hasText: /新建文档/ });
    await createBtn.click();

    // Modal should be visible now (display: flex)
    await expect(modal).toBeVisible();

    // Fill the form
    await page.locator('#ctx-layer').selectOption('team');
    await page.locator('#ctx-doc-type').selectOption('rule');
    await page.locator('#ctx-scope-id').fill('team_engineering');
    await page.locator('#ctx-title').fill('Code Review Rules');
    await page.locator('#ctx-content').fill('All PRs need 2 approvals.');

    // Click save
    const saveBtn = modal.locator('button', { hasText: /保存/ });
    await saveBtn.click();

    await page.waitForTimeout(500);
    expect(postCalled).toBe(true);
    expect(postBody.layer).toBe('team');
    expect(postBody.doc_type).toBe('rule');
    expect(postBody.title).toBe('Code Review Rules');

    // Modal should close after save
    await expect(modal).toBeHidden();
  });

  // 17. Context 模态框关闭
  test('Context 模态框关闭 — 打开后点取消', async ({ page }) => {
    await gotoAdmin(page);

    // Switch to context tab
    await page.locator('.tab[data-tab="context"]').click();

    // Open modal
    await page.locator('#tab-context button', { hasText: /新建文档/ }).click();

    const modal = page.locator('#ctx-modal');
    await expect(modal).toBeVisible();

    // Click cancel
    const cancelBtn = modal.locator('button', { hasText: /取消/ });
    await cancelBtn.click();

    // Modal should be hidden
    await expect(modal).toBeHidden();
  });

  // 18. Owner 专属 Tab 可见
  test('Owner 专属 Tab 可见 — pricing-engine 和 billing', async ({ page }) => {
    await gotoAdmin(page);

    // Owner role: pricing-engine and billing tabs should be visible (not hidden)
    const pricingTab = page.locator('.tab[data-tab="pricing-engine"]');
    await expect(pricingTab).toBeVisible();

    const billingTab = page.locator('.tab[data-tab="billing"]');
    await expect(billingTab).toBeVisible();

    // Admin-only tabs (aimodels, audit) should also be visible for owner
    const aimodelsTab = page.locator('.tab[data-tab="aimodels"]');
    await expect(aimodelsTab).toBeVisible();

    const auditTab = page.locator('.tab[data-tab="audit"]');
    await expect(auditTab).toBeVisible();
  });
});

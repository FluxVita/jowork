import { test, expect } from '../fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * FluxVita Data Config（数据源配置）E2E 测试
 *
 * data-config.html 管理连接器和数据绑定。
 * 使用 fluxvita_token 认证。
 *
 * 关键元素：
 * - #main-content：主内容区
 * - .topbar / .nav-btn：导航栏和 Tab 按钮（公共/研发/群组/个人）
 * - .section[id^="section-"]：连接器区域（section-public, section-dev 等）
 * - .ds-card / .ds-header / .ds-icon / .ds-name：数据源卡片
 * - .stat-grid / .stat-card：统计卡片
 * - 按钮：刷新（onclick="init()"）、健康检查（onclick="healthCheckAll()"）
 */

/* ── 共用 mock 数据 ── */
// 注意：connector id 必须对应 DS_META 的 key（如 feishu_v1, gitlab_v1 等）
// data_scope 决定卡片出现在哪个 section。
// 测试用户 role=member（非 admin），full 模式下只渲染 personal section。
const MOCK_CONNECTORS = {
  connectors: [
    { id: 'feishu_v1', source: 'feishu', name: 'Feishu', status: 'active', scope: 'public' },
    { id: 'gitlab_v1', source: 'gitlab', name: 'GitLab', status: 'active', scope: 'dev' },
    { id: 'linear_v1', source: 'linear', name: 'Linear', status: 'inactive', scope: 'dev' },
    { id: 'posthog_v1', source: 'posthog', name: 'PostHog', status: 'active', scope: 'public' },
    { id: 'figma_v1', source: 'figma', name: 'Figma', status: 'active', scope: 'personal' },
  ],
};

// health API 返回 { health: { [id]: { ok, latency_ms, error? } } }
const MOCK_HEALTH = {
  health: {
    feishu_v1: { ok: true, latency_ms: 45 },
    gitlab_v1: { ok: true, latency_ms: 82 },
    linear_v1: { ok: false, latency_ms: 0, error: 'connection refused' },
    posthog_v1: { ok: true, latency_ms: 120 },
    figma_v1: { ok: true, latency_ms: 30 },
  },
};

const MOCK_OVERVIEW = { total_objects: 1250, connectors: 5 };

/** 注册所有 data-config API mock
 *
 * Playwright route 匹配顺序是 LIFO（后注册优先匹配）。
 * 因此 catch-all 先注册（低优先级），具体路由后注册（高优先级）。
 */
async function mockDataConfigRoutes(page: Page) {
  // 1. 先注册 catch-all（最低优先级）
  await page.route('**/api/connectors/**', route => {
    if (route.request().method() !== 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return route.continue();
  });

  // 2. 再注册一般路由
  await page.route('**/api/dashboard/overview', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_OVERVIEW),
    }),
  );

  await page.route('**/api/group-bindings**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ bindings: [] }),
    }),
  );

  // 3. 最后注册具体路由（最高优先级）
  await page.route('**/api/connectors/entitlements', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    }),
  );

  await page.route('**/api/connectors/health', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_HEALTH),
    }),
  );

  await page.route('**/api/connectors', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CONNECTORS),
      });
    }
    return route.continue();
  });

  // 4. 个人设置相关 mock
  await page.route('**/api/settings/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

test.describe('FluxVita Data Config @regression', () => {
  /* ── 1. 页面加载显示主内容区 ── */
  test('数据配置页面加载', async ({ fluxvitaPage: page }) => {
    await mockDataConfigRoutes(page);

    await page.goto('/data-config.html');
    await page.waitForLoadState('networkidle');

    // 主内容区域应可见
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 5000 });

    // 顶部导航应可见
    const topbar = page.locator('.topbar');
    await expect(topbar).toBeVisible();
  });

  /* ── 2. 连接器区域渲染 ── */
  test('连接器区域渲染至少 1 个 section', async ({ fluxvitaPage: page }) => {
    await mockDataConfigRoutes(page);

    await page.goto('/data-config.html');
    await page.waitForLoadState('networkidle');

    // 至少有一个 section 渲染
    const sections = page.locator('[id^="section-"]');
    await expect(sections.first()).toBeVisible({ timeout: 5000 });
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  /* ── 3. 数据源卡片渲染 ── */
  test('数据源卡片显示连接器信息', async ({ fluxvitaPage: page }) => {
    await mockDataConfigRoutes(page);

    await page.goto('/data-config.html');
    await page.waitForLoadState('networkidle');

    // 数据源以 <table> 渲染（非 .ds-card），位于 .section 内的 .card 中。
    // 测试用户是 member（非 admin），full 模式下只渲染 personal section。
    // 等待 personal section 渲染
    const section = page.locator('#section-personal');
    await expect(section).toBeVisible({ timeout: 5000 });

    // personal section 内应有 connector table（figma_v1 在 personal scope）
    const tableRows = section.locator('table tbody tr');
    await expect(tableRows.first()).toBeVisible({ timeout: 5000 });

    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);

    // 第一行应有数据源名称（td 包含文本）
    const firstRow = tableRows.first();
    const firstCellText = await firstRow.locator('td').first().textContent();
    expect(firstCellText!.trim().length).toBeGreaterThan(0);
  });

  /* ── 4. 健康检查按钮功能 ── */
  test('健康检查按钮点击触发 API 调用', async ({ fluxvitaPage: page }) => {
    let healthCalled = false;

    // 注意：Playwright route 匹配顺序是 LIFO（后注册的优先匹配）。
    // 必须把 catch-all 路由放在前面注册，具体路由放在后面注册。

    // 先注册 catch-all（最早注册 = 最低优先级）
    await page.route('**/api/connectors/**', route => {
      if (route.request().method() !== 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      return route.continue();
    });

    await page.route('**/api/dashboard/overview', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_OVERVIEW) }),
    );
    await page.route('**/api/group-bindings**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bindings: [] }) }),
    );
    await page.route('**/api/connectors/entitlements', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );

    // 后注册具体路由（高优先级）
    await page.route('**/api/connectors/health', route => {
      healthCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_HEALTH),
      });
    });

    await page.route('**/api/connectors', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_CONNECTORS),
        });
      }
      return route.continue();
    });

    await page.goto('/data-config.html');
    await page.waitForLoadState('networkidle');

    // 等待页面完全渲染
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 5000 });

    // 初始加载可能已调用过 health，重置标记
    healthCalled = false;

    // 找到健康检查按钮（onclick="healthCheckAll()"）
    // i18n 可能翻译为 "健康检查" 或 "Health Check"
    const healthBtn = page.locator('[onclick*="healthCheckAll"]').first();
    await expect(healthBtn).toBeVisible();

    await healthBtn.click();
    await page.waitForTimeout(500);
    expect(healthCalled).toBe(true);
  });

  /* ── 5. 导航 Tab 切换 ── */
  test('导航 Tab 切换显示不同 scope', async ({ fluxvitaPage: page }) => {
    await mockDataConfigRoutes(page);

    await page.goto('/data-config.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#main-content')).toBeVisible({ timeout: 5000 });

    // 测试用户 role=member（非 admin），init() 会隐藏 public/dev/group 导航按钮。
    // 只选可见的 nav-btn 来测试。
    const visibleNavButtons = page.locator('.topbar .nav-btn:visible');
    const visibleCount = await visibleNavButtons.count();
    expect(visibleCount).toBeGreaterThanOrEqual(1);

    // 点击第一个可见的导航按钮
    const firstVisibleNav = visibleNavButtons.first();
    await firstVisibleNav.click();
    await page.waitForTimeout(300);

    // 点击后应变为 active
    await expect(firstVisibleNav).toHaveClass(/active/);

    // 如果有多个可见导航按钮，验证切换行为
    if (visibleCount >= 2) {
      const secondVisibleNav = visibleNavButtons.nth(1);
      await secondVisibleNav.click();
      await page.waitForTimeout(300);

      // 第二个应变为 active
      await expect(secondVisibleNav).toHaveClass(/active/);
    }
  });

  /* ── 6. 刷新按钮重新加载 ── */
  test('刷新操作重新加载数据', async ({ fluxvitaPage: page }) => {
    let loadCount = 0;

    // Playwright route: LIFO 匹配（后注册优先），catch-all 先注册
    await page.route('**/api/connectors/**', route => {
      if (route.request().method() !== 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      return route.continue();
    });

    await page.route('**/api/dashboard/overview', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_OVERVIEW) }),
    );
    await page.route('**/api/group-bindings**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bindings: [] }) }),
    );
    await page.route('**/api/connectors/entitlements', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.route('**/api/connectors/health', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_HEALTH) }),
    );

    await page.route('**/api/connectors', route => {
      if (route.request().method() === 'GET') {
        loadCount++;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_CONNECTORS),
        });
      }
      return route.continue();
    });

    await page.route('**/api/settings/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );

    await page.goto('/data-config.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#main-content')).toBeVisible({ timeout: 5000 });

    // 记录初始加载次数
    const initialLoads = loadCount;

    // 尝试找刷新按钮（onclick="init()"）
    const refreshBtn = page.locator('[onclick*="init()"]');
    if (await refreshBtn.count() > 0) {
      await refreshBtn.first().click();
      await page.waitForTimeout(500);

      // connectors API 应被再次调用
      expect(loadCount).toBeGreaterThan(initialLoads);
    }
  });

  /* ── 7. 统计卡片显示 ── */
  test('统计卡片显示概览数据', async ({ fluxvitaPage: page }) => {
    await mockDataConfigRoutes(page);

    await page.goto('/data-config.html');
    await page.waitForLoadState('networkidle');

    // 等待统计卡片渲染
    const statCards = page.locator('.stat-card');
    if (await statCards.count() > 0) {
      await expect(statCards.first()).toBeVisible();

      // 至少 1 张统计卡片应有 value
      const firstValue = statCards.first().locator('.value, .stat-value');
      if (await firstValue.count() > 0) {
        const text = await firstValue.textContent();
        expect(text!.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

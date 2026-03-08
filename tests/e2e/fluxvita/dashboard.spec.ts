import { test, expect } from '../fixtures/auth';
import type { Page, Route } from '@playwright/test';

/**
 * FluxVita Dashboard 看板 E2E 测试
 *
 * dashboard.html 有 3 个子 Tab: posthog, gitlab, personal。
 * 数据通过 API 获取，每 60 秒自动刷新。
 */

// ── Mock 数据 ──

const MOCK_POSTHOG = {
  insights: {
    total: 42,
    by_type: [
      { insight_type: 'TRENDS', n: 20 },
      { insight_type: 'FUNNELS', n: 12 },
      { insight_type: 'RETENTION', n: 10 },
    ],
    recent: [
      { title: 'DAU trend', insight_type: 'TRENDS', external_url: 'https://ph.example.com/1', updated_at: '2026-03-07T10:00:00Z' },
      { title: 'Onboarding funnel', insight_type: 'FUNNELS', external_url: 'https://ph.example.com/2', updated_at: '2026-03-06T08:00:00Z' },
    ],
  },
  dashboards: [
    { title: 'Growth', pinned: true, external_url: 'https://ph.example.com/d/1' },
    { title: 'Retention', pinned: false, external_url: 'https://ph.example.com/d/2' },
  ],
};

const MOCK_GITLAB = {
  repositories: [
    { title: 'fluxvita-gateway', external_url: 'https://gitlab.com/fluxvita/gateway', updated_at: '2026-03-07T10:00:00Z' },
    { title: 'fluxvita-app', external_url: 'https://gitlab.com/fluxvita/app', updated_at: '2026-03-06T09:00:00Z' },
  ],
  merge_requests: {
    by_state: [
      { state: 'opened', n: 5 },
      { state: 'merged', n: 30 },
      { state: 'closed', n: 3 },
    ],
    recent: [
      { title: 'feat: add billing', state: 'opened', owner: 'Aiden', external_url: 'https://gitlab.com/fluxvita/gateway/-/merge_requests/287', updated_at: '2026-03-07T09:00:00Z' },
      { title: 'fix: auth bug', state: 'merged', owner: 'Dev', external_url: 'https://gitlab.com/fluxvita/gateway/-/merge_requests/286', updated_at: '2026-03-06T15:00:00Z' },
    ],
  },
};

const MOCK_OVERVIEW = { total_objects: 100 };

// ── Mock 路由 ──

async function mockAllRoutes(page: Page) {
  await page.route('**/api/auth/me', (route: Route) =>
    route.fulfill({ json: { user: { user_id: 'usr_1', name: 'Admin', role: 'owner' } } }));

  await page.route('**/api/dashboard/posthog', (route: Route) =>
    route.fulfill({ json: MOCK_POSTHOG }));

  await page.route('**/api/dashboard/gitlab', (route: Route) =>
    route.fulfill({ json: MOCK_GITLAB }));

  await page.route('**/api/dashboard/overview', (route: Route) =>
    route.fulfill({ json: MOCK_OVERVIEW }));
}

async function gotoDashboard(page: Page) {
  await mockAllRoutes(page);
  await page.addInitScript(() => {
    localStorage.setItem('fluxvita_token', 'mock-jwt-token');
    localStorage.setItem('fv_admin_token', 'mock-jwt-token');
  });
  await page.goto('/dashboard.html');
  // Wait for content to render (posthog is default)
  await page.locator('#content').waitFor({ timeout: 5000 });
  // Wait for posthog data to render (grid with cards)
  await page.locator('#content .grid').waitFor({ state: 'attached', timeout: 5000 });
}

// ═══════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════

test.describe('FluxVita Dashboard @smoke', () => {

  // 1. 看板页面正常加载 — 标题 + subtab 导航栏
  test('看板页面加载 — 标题 + subtab 栏可见', async ({ page }) => {
    await gotoDashboard(page);

    await expect(page).toHaveTitle(/数据看板|Dashboard/i);

    // Subtab bar visible
    const subtabs = page.locator('.subtabs');
    await expect(subtabs).toBeVisible();

    // 3 subtabs exist
    const tabs = page.locator('.subtab');
    await expect(tabs).toHaveCount(3);

    // posthog tab should be active by default
    const posthogTab = page.locator('.subtab[data-tab="posthog"]');
    await expect(posthogTab).toHaveClass(/active/);
  });

  // 2. PostHog Tab — 数据卡片和表格渲染
  test('PostHog Tab — 数据卡片和表格', async ({ page }) => {
    await gotoDashboard(page);

    const content = page.locator('#content');

    // Grid cards should render (insights total + dashboards count + type breakdowns)
    const cards = content.locator('.card');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThanOrEqual(3);

    // First card: "数据分析总数" with value 42
    const firstCard = cards.first();
    await expect(firstCard.locator('.value')).toContainText('42');

    // Dashboard table should exist
    const tableWraps = content.locator('.table-wrap');
    const tableCount = await tableWraps.count();
    expect(tableCount).toBeGreaterThanOrEqual(2);

    // Dashboard table should have "Growth" row
    await expect(content).toContainText('Growth');

    // Pinned dashboard should show badge
    await expect(content.locator('.badge-green')).toBeVisible();
  });

  // 3. Tab 切换 — posthog -> gitlab
  test('Tab 切换 — posthog -> gitlab', async ({ page }) => {
    await gotoDashboard(page);

    const gitlabTab = page.locator('.subtab[data-tab="gitlab"]');
    const posthogTab = page.locator('.subtab[data-tab="posthog"]');

    // Click gitlab tab
    await gitlabTab.click();

    // gitlab tab should be active, posthog inactive
    await expect(gitlabTab).toHaveClass(/active/);
    await expect(posthogTab).not.toHaveClass(/active/);

    // Wait for content to re-render with gitlab data
    const content = page.locator('#content');
    await content.locator('.grid').waitFor({ state: 'attached', timeout: 5000 });

    // Should show repository count card
    await expect(content.locator('.card').first()).toContainText('2');

    // Should show MR states
    await expect(content).toContainText(/进行中|opened/i);
    await expect(content).toContainText(/已合并|merged/i);
  });

  // 4. GitLab Tab — 仓库和 MR 表格渲染
  test('GitLab Tab — 仓库表 + MR 表', async ({ page }) => {
    await gotoDashboard(page);

    // Switch to gitlab
    await page.locator('.subtab[data-tab="gitlab"]').click();

    const content = page.locator('#content');
    await content.locator('.table-wrap').first().waitFor({ state: 'attached', timeout: 5000 });

    // Repository table should show repo names
    await expect(content).toContainText('fluxvita-gateway');
    await expect(content).toContainText('fluxvita-app');

    // MR table should show merge request titles
    await expect(content).toContainText('feat: add billing');
    await expect(content).toContainText('fix: auth bug');

    // MR should show author names
    await expect(content).toContainText('Aiden');
  });

  // 5. Tab 切换 — gitlab -> personal (iframe 模式)
  test('Tab 切换 — gitlab -> personal (iframe)', async ({ page }) => {
    await gotoDashboard(page);

    // Switch to personal
    const personalTab = page.locator('.subtab[data-tab="personal"]');
    await personalTab.click();

    await expect(personalTab).toHaveClass(/active/);

    // Content area should be hidden, personal-frame should show
    const content = page.locator('#content');
    await expect(content).toBeHidden();

    const frame = page.locator('#personal-frame');
    await expect(frame).toBeVisible();
  });

  // 6. Tab 切换回 — personal -> posthog
  test('Tab 切换回 — personal -> posthog 恢复显示', async ({ page }) => {
    await gotoDashboard(page);

    // Go to personal first
    await page.locator('.subtab[data-tab="personal"]').click();
    await expect(page.locator('#content')).toBeHidden();

    // Switch back to posthog
    const posthogTab = page.locator('.subtab[data-tab="posthog"]');
    await posthogTab.click();

    await expect(posthogTab).toHaveClass(/active/);

    // Content area should be visible again
    const content = page.locator('#content');
    await expect(content).toBeVisible();

    // Personal frame should be hidden
    await expect(page.locator('#personal-frame')).toBeHidden();

    // PostHog data should re-render
    await content.locator('.grid').waitFor({ state: 'attached', timeout: 5000 });
    await expect(content).toContainText('42');
  });

  // 7. 外部链接有 target=_blank
  test('外部链接有 target=_blank', async ({ page }) => {
    await gotoDashboard(page);

    // PostHog tab rendered — check dashboard links
    const content = page.locator('#content');
    await content.locator('.table-wrap').first().waitFor({ state: 'attached', timeout: 5000 });

    const externalLinks = content.locator('a[target="_blank"]');
    const linkCount = await externalLinks.count();
    expect(linkCount).toBeGreaterThanOrEqual(1);

    // Verify a link href points to posthog
    const firstLink = externalLinks.first();
    const href = await firstLink.getAttribute('href');
    expect(href).toContain('ph.example.com');
  });

  // 8. GitLab 外部链接也有 target=_blank
  test('GitLab 外部链接有 target=_blank', async ({ page }) => {
    await gotoDashboard(page);

    // Switch to gitlab
    await page.locator('.subtab[data-tab="gitlab"]').click();

    const content = page.locator('#content');
    await content.locator('.table-wrap').first().waitFor({ state: 'attached', timeout: 5000 });

    const externalLinks = content.locator('a[target="_blank"]');
    const linkCount = await externalLinks.count();
    expect(linkCount).toBeGreaterThanOrEqual(2); // repos + MRs

    // Verify a link points to gitlab
    const hrefs: string[] = [];
    for (let i = 0; i < linkCount; i++) {
      const href = await externalLinks.nth(i).getAttribute('href');
      if (href) hrefs.push(href);
    }
    expect(hrefs.some(h => h.includes('gitlab.com'))).toBe(true);
  });

  // 9. Active class 唯一性 — 同一时刻只有一个 tab active
  test('Active class 唯一性 — 同一时刻只有一个 subtab active', async ({ page }) => {
    await gotoDashboard(page);

    const tabs = ['posthog', 'gitlab', 'posthog'];
    for (const tab of tabs) {
      await page.locator(`.subtab[data-tab="${tab}"]`).click();
      await page.waitForTimeout(200);

      const activeCount = await page.locator('.subtab.active').count();
      expect(activeCount).toBe(1);

      const activeTab = page.locator('.subtab.active');
      await expect(activeTab).toHaveAttribute('data-tab', tab);
    }
  });
});

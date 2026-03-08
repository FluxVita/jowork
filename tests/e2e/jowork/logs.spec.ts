import { test, expect } from '../fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * Jowork Logs 活动日志页面 E2E 测试
 *
 * logs.html 使用 fv_token（非 jowork_token）进行 API 认证。
 * 4 个 tab: sessions / tools / chart / errors
 * 数据来自 /api/logs/mine?days=N，包含 sessions, toolCalls, tokenByDay, errorLogs。
 */

const mockLogsData = {
  sessions: [
    { title: 'Chat with AI', engine: 'builtin', message_count: 5, total_tokens: 1200, total_cost: 0.0024, updated_at: '2026-03-07T10:00:00Z' },
    { title: 'Code Review', engine: 'moonshot', message_count: 3, total_tokens: 800, total_cost: 0.0016, updated_at: '2026-03-06T14:00:00Z' },
  ],
  toolCalls: [
    { tool_name: 'search_data', tool_status: 'success', duration_ms: 120, tokens: 300, session_title: 'Chat with AI', created_at: '2026-03-07T10:01:00Z' },
    { tool_name: 'fetch_content', tool_status: 'success', duration_ms: 250, tokens: 500, session_title: 'Chat with AI', created_at: '2026-03-07T10:02:00Z' },
    { tool_name: 'run_query', tool_status: 'error', duration_ms: 50, tokens: 20, session_title: 'Code Review', created_at: '2026-03-06T14:05:00Z' },
  ],
  errorLogs: [
    { ts: '2026-03-07T09:00:00Z', level: 'error', message: 'Connection timeout to external API' },
    { ts: '2026-03-06T16:30:00Z', level: 'warn', message: 'Rate limit approaching threshold' },
  ],
  tokenByDay: [
    { day: '2026-03-07', tokens: 1500, cost_usd: 0.004, calls: 5 },
    { day: '2026-03-06', tokens: 800, cost_usd: 0.002, calls: 3 },
    { day: '2026-03-05', tokens: 2000, cost_usd: 0.005, calls: 8 },
  ],
};

async function setupLogsMocks(page: Page) {
  // logs.html reads fv_token, sync it from jowork_token
  await page.addInitScript(() => {
    const jt = localStorage.getItem('jowork_token');
    if (jt) localStorage.setItem('fv_token', jt);
  });

  await page.route('**/api/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user_id: 'usr_1', name: 'Test User', role: 'admin' }),
    }),
  );
  await page.route('**/api/logs/mine**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockLogsData),
    }),
  );
}

test.describe('Jowork Logs - Deep Interaction Tests', () => {

  // ── Test 1: Page load with summary cards ──
  test('日志页面加载 -- summary cards visible', async ({ joworkPage: page }) => {
    await setupLogsMocks(page);

    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // Page title
    await expect(page.locator('h1')).toBeVisible();

    // Summary stat cards should render
    const statCards = page.locator('.stat-card');
    await expect(statCards.first()).toBeVisible({ timeout: 5000 });
    const count = await statCards.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Each stat card should have value and label
    await expect(statCards.first().locator('.value')).toBeVisible();
    await expect(statCards.first().locator('.label')).toBeVisible();
  });

  // ── Test 2: Default Sessions tab ──
  test('默认 Sessions tab -- sessions tab active, table visible', async ({ joworkPage: page }) => {
    await setupLogsMocks(page);

    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // Sessions tab should be active by default
    const tabs = page.locator('.tabs .tab');
    await expect(tabs.first()).toHaveClass(/active/);

    // Sessions content visible
    await expect(page.locator('#tab-sessions')).toBeVisible();

    // Sessions table should have data from mock
    const sessionsBody = page.locator('#sessions-body');
    await expect(sessionsBody).toBeVisible();
    await expect(sessionsBody).toContainText('Chat with AI');
    await expect(sessionsBody).toContainText('Code Review');

    // Other tabs should be hidden
    await expect(page.locator('#tab-tools')).toBeHidden();
    await expect(page.locator('#tab-chart')).toBeHidden();
    await expect(page.locator('#tab-errors')).toBeHidden();
  });

  // ── Test 3: Switch to Tools tab ──
  test('切换到 Tools tab -- click -> tools table visible', async ({ joworkPage: page }) => {
    await setupLogsMocks(page);

    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // Click tools tab (2nd tab)
    await page.locator('.tabs .tab').nth(1).click();

    // Tools tab visible, sessions hidden
    await expect(page.locator('#tab-tools')).toBeVisible();
    await expect(page.locator('#tab-sessions')).toBeHidden();

    // Tools tab should be active
    await expect(page.locator('.tabs .tab').nth(1)).toHaveClass(/active/);
    await expect(page.locator('.tabs .tab').first()).not.toHaveClass(/active/);

    // Tools table should have data
    const toolsBody = page.locator('#tools-body');
    await expect(toolsBody).toBeVisible();
    await expect(toolsBody).toContainText('search_data');

    // Pagination buttons should exist
    await expect(page.locator('#tools-prev')).toBeVisible();
    await expect(page.locator('#tools-next')).toBeVisible();
  });

  // ── Test 4: Switch to Chart tab ──
  test('切换到 Chart tab -- click -> chart area visible', async ({ joworkPage: page }) => {
    await setupLogsMocks(page);

    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // Click chart tab (3rd tab)
    await page.locator('.tabs .tab').nth(2).click();

    // Chart tab visible
    await expect(page.locator('#tab-chart')).toBeVisible();
    await expect(page.locator('#tab-sessions')).toBeHidden();
    await expect(page.locator('#tab-tools')).toBeHidden();

    // Chart bars area should exist
    await expect(page.locator('#chart-bars')).toBeAttached();

    // Chart tab should be active
    await expect(page.locator('.tabs .tab').nth(2)).toHaveClass(/active/);
  });

  // ── Test 5: Switch to Errors tab ──
  test('切换到 Errors tab -- click -> errors box visible', async ({ joworkPage: page }) => {
    await setupLogsMocks(page);

    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // Click errors tab (4th tab)
    await page.locator('.tabs .tab').nth(3).click();

    // Errors tab visible
    await expect(page.locator('#tab-errors')).toBeVisible();
    await expect(page.locator('#tab-sessions')).toBeHidden();

    // Errors box should be visible
    const errorsBox = page.locator('#errors-box');
    await expect(errorsBox).toBeVisible();

    // Should contain error log entries
    await expect(errorsBox).toContainText('Connection timeout');

    // Errors tab active
    await expect(page.locator('.tabs .tab').nth(3)).toHaveClass(/active/);
  });

  // ── Test 6: Date filter ──
  test('日期筛选 -- change to 7 days -> API re-called', async ({ joworkPage: page }) => {
    await setupLogsMocks(page);

    let lastDaysParam = '';
    await page.route('**/api/logs/mine**', route => {
      const url = new URL(route.request().url(), 'http://localhost');
      lastDaysParam = url.searchParams.get('days') ?? '';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockLogsData),
      });
    });

    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // Days select should be visible with default 30
    const daysSel = page.locator('#days-sel');
    await expect(daysSel).toBeVisible();
    await expect(daysSel).toHaveValue('30');

    // Change to 7 days
    await daysSel.selectOption('7');
    await expect(daysSel).toHaveValue('7');

    // Wait for API call
    await page.waitForTimeout(500);

    // API should have been called with days=7
    expect(lastDaysParam).toBe('7');
  });

  // ── Test 7: Tab switching preserves data ──
  test('Tab 切换来回 -- 数据不丢失', async ({ joworkPage: page }) => {
    await setupLogsMocks(page);

    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // Verify sessions data
    await expect(page.locator('#sessions-body')).toContainText('Chat with AI');

    // Switch to tools
    await page.locator('.tabs .tab').nth(1).click();
    await expect(page.locator('#tools-body')).toContainText('search_data');

    // Switch back to sessions
    await page.locator('.tabs .tab').first().click();
    await expect(page.locator('#tab-sessions')).toBeVisible();
    // Data should still be there
    await expect(page.locator('#sessions-body')).toContainText('Chat with AI');
  });

  // ── Test 8: 90 days option ──
  test('90 天选项可选', async ({ joworkPage: page }) => {
    await setupLogsMocks(page);

    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    const daysSel = page.locator('#days-sel');
    await daysSel.selectOption('90');
    await expect(daysSel).toHaveValue('90');
  });
});

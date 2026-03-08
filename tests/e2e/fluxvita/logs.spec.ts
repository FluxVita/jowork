import { test, expect } from '../fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * FluxVita Logs 活动日志页面 E2E 测试
 *
 * logs.html 使用 fv_token（非 fluxvita_token）认证。
 * 包含 sessions / tools / chart / errors 四个 Tab，以及日期筛选和分页。
 *
 * 关键元素：
 * - #days-sel：日期筛选 select
 * - .tab：Tab 按钮（onclick switchTab）
 * - #tab-sessions / #sessions-body
 * - #tab-tools / #tools-body / #tools-prev / #tools-next
 * - #tab-chart / #chart-bars / #chart-body
 * - #tab-errors / #errors-box
 * - #summary-cards（.stat-grid > .stat-card）
 */

/* ── 共用 mock 数据 ── */
const MOCK_LOGS = {
  sessions: [
    { title: 'Test Session 1', engine: 'builtin', message_count: 5, total_tokens: 1000, total_cost: 0.002, updated_at: '2026-03-07T10:00:00Z' },
    { title: 'Test Session 2', engine: 'moonshot', message_count: 3, total_tokens: 500, total_cost: 0.001, updated_at: '2026-03-06T15:30:00Z' },
  ],
  toolCalls: Array.from({ length: 25 }, (_, i) => ({
    tool_name: `tool_${i}`,
    tool_status: i % 5 === 0 ? 'error' : 'success',
    duration_ms: 50 + i * 10,
    tokens: 20 + i * 5,
    session_title: `Session ${Math.floor(i / 5)}`,
    created_at: `2026-03-0${7 - Math.floor(i / 10)}T${10 + (i % 10)}:00:00Z`,
  })),
  tokenByDay: [
    { day: '2026-03-07', tokens: 800, cost_usd: 0.0016, calls: 12 },
    { day: '2026-03-06', tokens: 500, cost_usd: 0.001, calls: 8 },
    { day: '2026-03-05', tokens: 300, cost_usd: 0.0006, calls: 5 },
  ],
  errorLogs: [
    { ts: '2026-03-07T10:00:00Z', level: 'error', component: 'agent', message: 'test error: context overflow' },
    { ts: '2026-03-06T14:30:00Z', level: 'warn', component: 'tools', message: 'search timeout after 5000ms' },
  ],
};

const MOCK_ME = { user_id: 'usr_test_1', name: 'E2E-Test', role: 'admin' };

/** 注入 fv_token 并注册所有 logs API mock */
async function mockLogsRoutes(page: Page, logsData: object = MOCK_LOGS) {
  // logs.html 使用 fv_token 而非 fluxvita_token
  // 同时设置 locale 为 zh 确保中文 i18n
  await page.addInitScript(() => {
    const t = localStorage.getItem('fluxvita_token');
    if (t) localStorage.setItem('fv_token', t);
    localStorage.setItem('jowork_locale', 'zh');
  });

  await page.route('**/api/auth/me', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ME) }),
  );
  await page.route('**/api/logs/mine**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(logsData) }),
  );
}

test.describe('FluxVita Logs @regression', () => {
  /* ── 1. 活动日志页面加载 ── */
  test('活动日志页面加载', async ({ fluxvitaPage: page }) => {
    await mockLogsRoutes(page);
    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // h1 应可见
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('h1')).toContainText('活动日志');

    // 汇总卡片应渲染（5 张：对话数、Token、费用、工具调用、错误）
    const statCards = page.locator('.stat-card');
    await expect(statCards.first()).toBeVisible({ timeout: 5000 });
    const count = await statCards.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // 对话数应为 2
    const firstCardValue = statCards.first().locator('.value');
    await expect(firstCardValue).toContainText('2');
  });

  /* ── 2. Tab 切换到 Sessions（默认） ── */
  test('Sessions Tab 默认活跃且显示表格行', async ({ fluxvitaPage: page }) => {
    await mockLogsRoutes(page);
    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // sessions tab 默认可见
    await expect(page.locator('#tab-sessions')).toBeVisible();

    // 第一个 tab 按钮应有 active class
    const firstTab = page.locator('.tab').first();
    await expect(firstTab).toHaveClass(/active/);

    // sessions 表格应有数据行（2 条 session）
    const rows = page.locator('#sessions-body tr');
    await expect(rows.first()).toBeVisible({ timeout: 5000 });
    const rowCount = await rows.count();
    expect(rowCount).toBe(2);

    // 行内容验证
    await expect(rows.first()).toContainText('Test Session 1');
    await expect(rows.first()).toContainText('builtin');
  });

  /* ── 3. Tab 切换到 Tools ── */
  test('Tab 切换到 Tools 显示工具表格', async ({ fluxvitaPage: page }) => {
    await mockLogsRoutes(page);
    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // 等待初始数据加载
    await expect(page.locator('#tab-sessions')).toBeVisible();

    // 点击 Tools tab（第 2 个 .tab 按钮）
    await page.locator('.tab').nth(1).click();

    // tools tab 应可见，sessions 应隐藏
    await expect(page.locator('#tab-tools')).toBeVisible();
    await expect(page.locator('#tab-sessions')).toBeHidden();

    // tools tab 按钮应有 active class
    await expect(page.locator('.tab').nth(1)).toHaveClass(/active/);
    await expect(page.locator('.tab').first()).not.toHaveClass(/active/);

    // 工具调用表格应有数据
    const toolRows = page.locator('#tools-body tr');
    await expect(toolRows.first()).toBeVisible();
    const toolRowCount = await toolRows.count();
    expect(toolRowCount).toBeGreaterThanOrEqual(1);
  });

  /* ── 4. Tab 切换到 Chart ── */
  test('Tab 切换到 Chart 显示柱状图', async ({ fluxvitaPage: page }) => {
    await mockLogsRoutes(page);
    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#tab-sessions')).toBeVisible();

    // 点击 Chart tab（第 3 个 .tab）
    await page.locator('.tab').nth(2).click();

    // chart tab 应可见
    await expect(page.locator('#tab-chart')).toBeVisible();
    await expect(page.locator('#tab-sessions')).toBeHidden();
    await expect(page.locator('#tab-tools')).toBeHidden();

    // 柱状图区域应有内容（bar-row）
    const barRows = page.locator('#chart-bars .bar-row');
    await expect(barRows.first()).toBeVisible();
    const barCount = await barRows.count();
    expect(barCount).toBe(3); // 3 天的数据

    // 表格也应有日期行
    const chartBodyRows = page.locator('#chart-body tr');
    const chartRowCount = await chartBodyRows.count();
    expect(chartRowCount).toBe(3);
  });

  /* ── 5. Tab 切换到 Errors ── */
  test('Tab 切换到 Errors 显示错误日志', async ({ fluxvitaPage: page }) => {
    await mockLogsRoutes(page);
    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#tab-sessions')).toBeVisible();

    // 点击 Errors tab（第 4 个 .tab）
    await page.locator('.tab').nth(3).click();

    // errors tab 应可见
    await expect(page.locator('#tab-errors')).toBeVisible();

    // errors box 应有日志条目
    const errorsBox = page.locator('#errors-box');
    await expect(errorsBox).toBeVisible();

    const logLines = errorsBox.locator('.log-line');
    await expect(logLines.first()).toBeVisible();
    const errorCount = await logLines.count();
    expect(errorCount).toBe(2);

    // 应包含错误信息文本
    await expect(logLines.first()).toContainText('test error');
    await expect(logLines.first()).toContainText('[ERROR]');
  });

  /* ── 5b. 无错误时显示正常提示 ── */
  test('无错误时 Errors Tab 显示正常提示', async ({ fluxvitaPage: page }) => {
    await mockLogsRoutes(page, { ...MOCK_LOGS, errorLogs: [] });
    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    await page.locator('.tab').nth(3).click();
    await expect(page.locator('#tab-errors')).toBeVisible();

    // 应显示无错误的友好提示
    await expect(page.locator('#errors-box')).toContainText('无错误');
  });

  /* ── 6. 日期筛选 ── */
  test('日期筛选变更触发重新加载', async ({ fluxvitaPage: page }) => {
    const apiCalls: string[] = [];

    await page.addInitScript(() => {
      const t = localStorage.getItem('fluxvita_token');
      if (t) localStorage.setItem('fv_token', t);
    });

    await page.route('**/api/auth/me', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ME) }),
    );

    await page.route('**/api/logs/mine**', route => {
      apiCalls.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_LOGS),
      });
    });

    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // 等待初始加载（默认 days=30）
    await expect(page.locator('.stat-card').first()).toBeVisible({ timeout: 5000 });

    // 初始调用应包含 days=30
    expect(apiCalls.some(url => url.includes('days=30'))).toBe(true);

    // 记录当前调用数
    const callsBefore = apiCalls.length;

    // 切换到 7 天
    await page.locator('#days-sel').selectOption('7');

    // 等待新请求
    await page.waitForTimeout(500);

    // 应有新的 API 调用
    expect(apiCalls.length).toBeGreaterThan(callsBefore);

    // 最新调用应包含 days=7
    const lastCall = apiCalls[apiCalls.length - 1];
    expect(lastCall).toContain('days=7');
  });

  /* ── 7. Tools 分页 ── */
  test('Tools 分页功能', async ({ fluxvitaPage: page }) => {
    await mockLogsRoutes(page);
    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // 切换到 Tools tab
    await page.locator('.tab').nth(1).click();
    await expect(page.locator('#tab-tools')).toBeVisible();

    // 25 条工具调用，每页 20 条，应有 2 页

    // prev 按钮应禁用（第一页）
    await expect(page.locator('#tools-prev')).toBeDisabled();

    // next 按钮应启用
    await expect(page.locator('#tools-next')).toBeEnabled();

    // pager 显示文本应类似 "1-20 / 25"
    const pager = page.locator('#tools-pager');
    await expect(pager).toContainText('20');
    await expect(pager).toContainText('25');

    // 点击下一页
    await page.locator('#tools-next').click();

    // prev 应启用
    await expect(page.locator('#tools-prev')).toBeEnabled();

    // next 应禁用（最后一页）
    await expect(page.locator('#tools-next')).toBeDisabled();

    // pager 应更新显示
    await expect(pager).toContainText('21');

    // 点击上一页回到第一页
    await page.locator('#tools-prev').click();
    await expect(page.locator('#tools-prev')).toBeDisabled();
    await expect(page.locator('#tools-next')).toBeEnabled();
  });

  /* ── 8. 未登录时显示提示 ── */
  test('未登录时显示提示', async ({ page }) => {
    await page.addInitScript(() => { localStorage.clear(); });
    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('body')).toContainText('请先登录');
  });

  /* ── 9. Tab 之间来回切换保持状态 ── */
  test('Tab 来回切换不丢失数据', async ({ fluxvitaPage: page }) => {
    await mockLogsRoutes(page);
    await page.goto('/logs.html');
    await page.waitForLoadState('networkidle');

    // 验证 sessions 有数据
    await expect(page.locator('#sessions-body tr').first()).toBeVisible({ timeout: 5000 });

    // 切到 tools
    await page.locator('.tab').nth(1).click();
    await expect(page.locator('#tab-tools')).toBeVisible();

    // 切回 sessions
    await page.locator('.tab').first().click();
    await expect(page.locator('#tab-sessions')).toBeVisible();

    // 数据仍在
    const rows = page.locator('#sessions-body tr');
    const rowCount = await rows.count();
    expect(rowCount).toBe(2);
    await expect(rows.first()).toContainText('Test Session 1');
  });
});

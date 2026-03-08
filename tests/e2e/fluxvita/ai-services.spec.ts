import { test, expect } from '../fixtures/auth';

/**
 * FluxVita AI Services 页面 E2E 测试
 *
 * ai-services.html 展示 AI 服务卡片网格（Klaude、OpenRouter、Agent Browser 等）。
 * 使用 fv_admin_token 或 fluxvita_token 认证。
 *
 * 关键元素：
 * - .page-header / h1：页头
 * - .services-grid：服务卡片网格容器
 * - .service-card：单个服务卡片
 * - .card-header / .card-icon：卡片头部和图标
 * - .card-status / .status-dot / .status-text：状态指示
 * - .card-meta / .meta-row：详情元数据
 * - .card-actions / .btn：操作按钮
 */

test.describe('FluxVita AI Services @regression', () => {
  /* ── 1. 页面加载显示服务卡片 ── */
  test('页面加载显示页头和服务卡片', async ({ fluxvitaPage: page }) => {
    await page.route('**/api/ai-services/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // 页头应可见
    const header = page.locator('.page-header');
    await expect(header).toBeVisible();
    await expect(header.locator('h1')).toBeVisible();
    await expect(header.locator('h1')).toContainText(/AI/);

    // 服务卡片网格应可见
    const grid = page.locator('.services-grid');
    await expect(grid).toBeVisible({ timeout: 8000 });

    // 至少有 1 张服务卡片
    const cards = page.locator('.service-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  /* ── 2. 服务卡片结构完整 ── */
  test('服务卡片有 header、图标和状态', async ({ fluxvitaPage: page }) => {
    // Playwright route LIFO: 先注册 catch-all（低优先级），再注册具体路由（高优先级）
    await page.route('**/api/ai-services/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.route('**/api/models/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/agent/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    // klaude status 返回有效状态数据（后注册 = 高优先级，覆盖上面的 catch-all）
    await page.route('**/api/ai-services/klaude/status', route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ status: 'stopped', bin_exists: false }),
      }),
    );

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // 等待卡片渲染（只选 services-grid 内的卡片，排除隐藏的表单容器）
    const firstCard = page.locator('.services-grid > .service-card').first();
    await expect(firstCard).toBeVisible({ timeout: 8000 });

    // 卡片头应存在
    const cardHeader = firstCard.locator('.card-header');
    await expect(cardHeader).toBeVisible();

    // 卡片应有图标
    const cardIcon = firstCard.locator('.card-icon');
    await expect(cardIcon).toBeVisible();

    // 卡片应有状态徽章（实际 class 是 .status-badge，非 .card-status）
    const statusBadge = firstCard.locator('.status-badge');
    await expect(statusBadge).toBeVisible();

    // 状态指示点应存在
    await expect(statusBadge.locator('.status-dot')).toBeVisible();
  });

  /* ── 3. 多张卡片渲染 ── */
  test('多张服务卡片正确渲染', async ({ fluxvitaPage: page }) => {
    await page.route('**/api/ai-services/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.route('**/api/models/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/agent/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // 只选 services-grid 内的卡片，排除隐藏的 MCP/Skill 表单容器
    const cards = page.locator('.services-grid > .service-card');
    await expect(cards.first()).toBeVisible({ timeout: 8000 });

    // 每张卡片都应有 card-header
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      await expect(card.locator('.card-header')).toBeVisible();
    }
  });

  /* ── 4. 卡片有操作按钮 ── */
  test('服务卡片有操作按钮', async ({ fluxvitaPage: page }) => {
    await page.route('**/api/ai-services/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    const firstCard = page.locator('.service-card').first();
    await expect(firstCard).toBeVisible({ timeout: 8000 });

    // 卡片应有操作区
    const actions = firstCard.locator('.card-actions');
    await expect(actions).toBeVisible();

    // 至少有 1 个按钮
    const buttons = actions.locator('.btn');
    const btnCount = await buttons.count();
    expect(btnCount).toBeGreaterThanOrEqual(1);
  });

  /* ── 5. 服务卡片有元数据区域 ── */
  test('服务卡片有详情元数据', async ({ fluxvitaPage: page }) => {
    await page.route('**/api/ai-services/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    const firstCard = page.locator('.service-card').first();
    await expect(firstCard).toBeVisible({ timeout: 8000 });

    // 卡片应有元数据区
    const meta = firstCard.locator('.card-meta');
    await expect(meta).toBeVisible();

    // 应有 meta-row
    const metaRows = meta.locator('.meta-row');
    const rowCount = await metaRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);
  });
});

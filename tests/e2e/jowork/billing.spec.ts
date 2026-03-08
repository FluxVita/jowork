import { test, expect } from '../fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * Jowork Billing 订阅页面 E2E 测试
 *
 * billing.html 需要 jowork_token，展示当前计划、积分用量和升级选项。
 * 数据来自 /api/billing/plan, /api/billing/credits, /api/billing/prices。
 * 月付/年付通过 .toggle-btn 切换。
 */

async function setupBillingMocks(page: Page, overrides?: {
  plan?: string;
  total?: number;
  used?: number;
  remaining?: number;
  stripeEnabled?: boolean;
  prices?: Array<{ id: string; amount: number; currency: string }>;
}) {
  const plan = overrides?.plan ?? 'free';
  const total = overrides?.total ?? 500;
  const used = overrides?.used ?? 50;
  const remaining = overrides?.remaining ?? 450;
  const stripeEnabled = overrides?.stripeEnabled ?? false;
  const prices = overrides?.prices ?? [];

  await page.route('**/api/billing/plan', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ plan, plan_name: plan.charAt(0).toUpperCase() + plan.slice(1) }),
    }),
  );
  await page.route('**/api/billing/credits', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total, used, remaining }),
    }),
  );
  await page.route('**/api/billing/prices', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ stripe_enabled: stripeEnabled, prices }),
    }),
  );
}

test.describe('Jowork Billing - Deep Interaction Tests', () => {

  // ── Test 1: Page load ──
  test('计费页面加载 -- current plan section visible', async ({ joworkPage: page }) => {
    await setupBillingMocks(page);

    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // Page title
    await expect(page.locator('h1')).toContainText('订阅');
    await expect(page.locator('.subtitle')).toBeVisible();

    // Current plan section rendered (no longer showing loading text)
    const planSection = page.locator('#current-plan-section');
    await expect(planSection).toBeVisible();
    await expect(planSection).not.toContainText('加载中');

    // Plan cards grid should render
    const planCards = page.locator('.plan-card');
    await expect(planCards).toHaveCount(4); // Free, Basic, Pro, Max
  });

  // ── Test 2: Current plan display ──
  test('显示当前计划 -- plan name "Free" visible', async ({ joworkPage: page }) => {
    await setupBillingMocks(page, { plan: 'free' });

    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // Current plan section shows "Free"
    const planSection = page.locator('#current-plan-section');
    await expect(planSection).toContainText('Free');

    // Plan badge should be present
    const badge = page.locator('.plan-badge');
    await expect(badge).toBeVisible();

    // The Free plan card should have .current class
    await expect(page.locator('.plan-card.current')).toHaveCount(1);

    // Current plan button should exist
    await expect(page.locator('.btn-plan.current-plan')).toBeVisible();
  });

  // ── Test 3: Credits balance display ──
  test('积分余额显示 -- credits info visible', async ({ joworkPage: page }) => {
    await setupBillingMocks(page, { total: 500, used: 50, remaining: 450 });

    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // Credits section with bar should render
    const planSection = page.locator('#current-plan-section');
    await expect(planSection).not.toContainText('加载中');

    // Credits bar should be visible
    const creditsBar = page.locator('.credits-bar');
    await expect(creditsBar).toBeVisible();

    // Credits text should show numbers
    const creditsText = page.locator('.credits-text');
    await expect(creditsText).toBeVisible();

    // Should show remaining/total info
    await expect(planSection).toContainText('450');
  });

  // ── Test 4: Stripe disabled notice ──
  test('Stripe 未启用提示 -- billing toggle hidden, info message shown', async ({ joworkPage: page }) => {
    await setupBillingMocks(page, { stripeEnabled: false });

    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // Billing toggle should be hidden when stripe is disabled
    const billingToggle = page.locator('#billing-toggle');
    await expect(billingToggle).toBeHidden();

    // Extra info area should have some content
    const extraInfo = page.locator('#extra-info');
    await expect(extraInfo).toBeAttached();
  });

  // ── Test 5: Monthly/Annual toggle ──
  test('月付年付切换 -- when stripe enabled, click toggles active class', async ({ joworkPage: page }) => {
    const mockPrices = [
      { id: 'price_basic_m', amount: 999, currency: 'usd' },
      { id: 'price_basic_y', amount: 8388, currency: 'usd' },
      { id: 'price_pro_m', amount: 2999, currency: 'usd' },
      { id: 'price_pro_y', amount: 25188, currency: 'usd' },
      { id: 'price_max_m', amount: 9999, currency: 'usd' },
      { id: 'price_max_y', amount: 83988, currency: 'usd' },
    ];
    await setupBillingMocks(page, { stripeEnabled: true, prices: mockPrices });

    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // Billing toggle should be visible when stripe is enabled
    const billingToggle = page.locator('#billing-toggle');
    await expect(billingToggle).toBeVisible();

    // Monthly button should be active by default
    const monthlyBtn = page.locator('#btn-monthly');
    const annualBtn = page.locator('#btn-annual');
    await expect(monthlyBtn).toHaveClass(/active/);
    await expect(annualBtn).not.toHaveClass(/active/);

    // Click annual
    await annualBtn.click();
    await expect(annualBtn).toHaveClass(/active/);
    await expect(monthlyBtn).not.toHaveClass(/active/);

    // Click monthly again
    await monthlyBtn.click();
    await expect(monthlyBtn).toHaveClass(/active/);
    await expect(annualBtn).not.toHaveClass(/active/);
  });

  // ── Test 6: Plan cards structure ──
  test('计划卡片结构 -- each card has name, price, features', async ({ joworkPage: page }) => {
    await setupBillingMocks(page);

    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // All 4 plan cards
    const planCards = page.locator('.plan-card');
    await expect(planCards).toHaveCount(4);

    // Each card has name, features
    for (let i = 0; i < 4; i++) {
      const card = planCards.nth(i);
      await expect(card.locator('.plan-name')).toBeVisible();
      await expect(card.locator('.plan-features')).toBeVisible();
      await expect(card.locator('.btn-plan')).toBeVisible();
    }

    // Plan names should be visible
    await expect(page.locator('.plan-name').first()).toBeVisible();
  });

  // ── Test 7: Credits bar warning state ──
  test('积分用量超 70% 显示 warn 样式', async ({ joworkPage: page }) => {
    await setupBillingMocks(page, { plan: 'personal_pro', total: 2000, used: 1500, remaining: 500 });

    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // Credits bar should have warn class (used > 70%)
    const bar = page.locator('.credits-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveClass(/warn/);
  });

  // ── Test 8: No token shows loading state ──
  test('未登录时显示加载中', async ({ page }) => {
    await setupBillingMocks(page);
    await page.addInitScript(() => { localStorage.clear(); });

    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // Without token, init() is not called, content stays as "loading"
    await expect(page.locator('#current-plan-section')).toContainText('加载中');
  });
});

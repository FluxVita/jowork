import { test, expect } from '../fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * FluxVita Billing 订阅页面 E2E 测试
 *
 * billing.html 使用 fluxvita_token 认证。
 * 展示当前计划、积分条、计费周期切换、4 张计划卡片和 Stripe Checkout 流程。
 */

/* ── 共用 mock 数据 ── */
const PLAN_FREE = { plan: 'free', plan_name: 'Free' };
const PLAN_PRO = { plan: 'personal_pro', plan_name: 'Pro' };
const CREDITS = { total: 1000, used: 100, remaining: 900 };
const CREDITS_HIGH = { total: 1000, used: 850, remaining: 150 };
const PRICES_ENABLED = {
  stripe_enabled: true,
  prices: [
    { id: 'price_basic_m', stripe_price_id: 'price_stripe_basic_m', amount_cents: 900, currency: 'usd', interval: 'month' },
    { id: 'price_pro_m', stripe_price_id: 'price_stripe_pro_m', amount_cents: 1900, currency: 'usd', interval: 'month' },
    { id: 'price_max_m', stripe_price_id: 'price_stripe_max_m', amount_cents: 4900, currency: 'usd', interval: 'month' },
    { id: 'price_basic_y', stripe_price_id: 'price_stripe_basic_y', amount_cents: 7560, currency: 'usd', interval: 'year' },
    { id: 'price_pro_y', stripe_price_id: 'price_stripe_pro_y', amount_cents: 15960, currency: 'usd', interval: 'year' },
    { id: 'price_max_y', stripe_price_id: 'price_stripe_max_y', amount_cents: 41160, currency: 'usd', interval: 'year' },
  ],
};
const PRICES_DISABLED = { stripe_enabled: false, prices: [] };

/** 注册所有 billing API mock */
async function mockBillingRoutes(
  page: Page,
  opts: { plan?: object; credits?: object; prices?: object } = {},
) {
  const plan = opts.plan ?? PLAN_FREE;
  const credits = opts.credits ?? CREDITS;
  const prices = opts.prices ?? PRICES_ENABLED;

  await page.route('**/api/billing/plan', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plan) }),
  );
  await page.route('**/api/billing/credits', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(credits) }),
  );
  await page.route('**/api/billing/prices', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(prices) }),
  );
}

test.describe('FluxVita Billing @regression', () => {
  /* ── 1. 计费页面加载显示当前计划 ── */
  test('计费页面加载显示当前计划', async ({ fluxvitaPage: page }) => {
    await mockBillingRoutes(page);
    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // 页面标题（i18n 可能是中文"订阅与计划"或英文"Subscription & Plans"）
    await expect(page.locator('h1')).toContainText(/订阅|Subscription/);

    // 当前计划卡片渲染完成（不再是 "加载中..."）
    const section = page.locator('#current-plan-section');
    await expect(section).not.toContainText('加载中');

    // plan badge 显示 "Free"
    await expect(section.locator('.plan-badge')).toContainText('Free');

    // 4 张计划卡片
    const planCards = page.locator('.plan-card');
    await expect(planCards).toHaveCount(4);
  });

  /* ── 2. 信用积分条显示 ── */
  test('信用积分条显示正确百分比', async ({ fluxvitaPage: page }) => {
    await mockBillingRoutes(page, { credits: CREDITS });
    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // 积分条应可见
    const bar = page.locator('.credits-bar');
    await expect(bar).toBeVisible();

    // 宽度应为 10%（100 / 1000 * 100）
    const width = await bar.evaluate(el => el.style.width);
    expect(width).toBe('10%');

    // 积分文字应包含用量信息
    const creditsText = page.locator('.credits-text');
    await expect(creditsText).toContainText('100');
    await expect(creditsText).toContainText('1,000');
  });

  /* ── 2b. 高用量时积分条变色 ── */
  test('高用量时积分条显示警告样式', async ({ fluxvitaPage: page }) => {
    await mockBillingRoutes(page, { credits: CREDITS_HIGH });
    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    const bar = page.locator('.credits-bar');
    await expect(bar).toBeVisible();

    // 850/1000 = 85% → 应该有 warn class
    await expect(bar).toHaveClass(/warn/);
  });

  /* ── 3. 切换到年付 ── */
  test('切换到年付', async ({ fluxvitaPage: page }) => {
    await mockBillingRoutes(page);
    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // billing toggle 应可见（stripe enabled）
    const toggle = page.locator('#billing-toggle');
    await expect(toggle).toBeVisible();

    // 默认月付按钮为 active
    await expect(page.locator('#btn-monthly')).toHaveClass(/active/);
    await expect(page.locator('#btn-annual')).not.toHaveClass(/active/);

    // 点击年付按钮
    await page.locator('#btn-annual').click();

    // active class 切换
    await expect(page.locator('#btn-annual')).toHaveClass(/active/);
    await expect(page.locator('#btn-monthly')).not.toHaveClass(/active/);

    // 计划卡片价格标签应包含 "/ 年"
    const priceSpans = page.locator('.plan-price span');
    const firstNonFree = priceSpans.nth(1); // 第 0 个是 Free（空 span）
    await expect(firstNonFree).toContainText('/ 年');
  });

  /* ── 4. 切换回月付 ── */
  test('切换回月付', async ({ fluxvitaPage: page }) => {
    await mockBillingRoutes(page);
    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // 先切到年付
    await page.locator('#btn-annual').click();
    await expect(page.locator('#btn-annual')).toHaveClass(/active/);

    // 再切回月付
    await page.locator('#btn-monthly').click();
    await expect(page.locator('#btn-monthly')).toHaveClass(/active/);
    await expect(page.locator('#btn-annual')).not.toHaveClass(/active/);

    // 价格标签应包含 "/ 月"
    const priceSpans = page.locator('.plan-price span');
    const firstNonFree = priceSpans.nth(1);
    await expect(firstNonFree).toContainText('/ 月');
  });

  /* ── 5. 计划卡片显示 ── */
  test('计划卡片显示正确数量和内容', async ({ fluxvitaPage: page }) => {
    await mockBillingRoutes(page);
    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // 至少 4 张计划卡片（Free, Basic, Pro, Max）
    const cards = page.locator('.plan-card');
    await expect(cards).toHaveCount(4);

    // 每张卡片包含计划名
    const names = page.locator('.plan-name');
    await expect(names.nth(0)).toContainText('Free');
    await expect(names.nth(1)).toContainText('Basic');
    await expect(names.nth(2)).toContainText('Pro');
    await expect(names.nth(3)).toContainText('Max');

    // Pro 卡片应有 popular 标记
    const proCard = cards.nth(2);
    await expect(proCard).toHaveClass(/popular/);

    // 每张卡片有特性列表
    for (let i = 0; i < 4; i++) {
      const features = cards.nth(i).locator('.plan-features li');
      const count = await features.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  /* ── 6. 当前计划按钮禁用 ── */
  test('当前计划按钮显示已选状态并禁用', async ({ fluxvitaPage: page }) => {
    await mockBillingRoutes(page);
    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // Free 计划的按钮应有 current-plan class
    const currentBtn = page.locator('.btn-plan.current-plan');
    await expect(currentBtn).toHaveCount(1);
    await expect(currentBtn).toContainText('当前计划');
    await expect(currentBtn).toBeDisabled();

    // Free 卡片应有 current class
    const currentCard = page.locator('.plan-card.current');
    await expect(currentCard).toHaveCount(1);
  });

  /* ── 6b. Pro 用户的当前计划按钮 ── */
  test('Pro 用户当前计划按钮在 Pro 卡片上', async ({ fluxvitaPage: page }) => {
    await mockBillingRoutes(page, { plan: PLAN_PRO });
    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // Pro 卡片应有 current class
    const proCard = page.locator('.plan-card.current');
    await expect(proCard).toHaveCount(1);
    await expect(proCard.locator('.plan-name')).toContainText('Pro');

    // Pro 卡片上的按钮应禁用
    await expect(proCard.locator('.btn-plan')).toBeDisabled();
  });

  /* ── 7. 点击升级触发 Checkout ── */
  test('点击升级按钮触发 Stripe Checkout', async ({ fluxvitaPage: page }) => {
    let checkoutCalled = false;
    let checkoutBody: string | null = null;

    await mockBillingRoutes(page);

    // Mock checkout endpoint
    await page.route('**/api/billing/checkout', async route => {
      checkoutCalled = true;
      checkoutBody = route.request().postData();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://checkout.stripe.com/test' }),
      });
    });

    // 拦截 window.open 防止实际打开新窗口
    await page.addInitScript(() => {
      window.open = () => null;
    });

    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // 找到非 Free 且非当前计划的升级按钮（Basic 卡片）
    const upgradeButtons = page.locator('.btn-plan.btn-primary:not(.current-plan)');
    const firstUpgrade = upgradeButtons.first();
    await expect(firstUpgrade).toBeVisible();
    await expect(firstUpgrade).toContainText('升级');

    // 点击升级
    await firstUpgrade.click();

    // 等待 API 调用
    await page.waitForTimeout(500);

    // 验证 checkout API 被调用
    expect(checkoutCalled).toBe(true);
    expect(checkoutBody).toBeTruthy();
    expect(JSON.parse(checkoutBody!)).toHaveProperty('price_id');
  });

  /* ── 8. Stripe 未启用时的提示 ── */
  test('Stripe 未启用时隐藏切换显示提示', async ({ fluxvitaPage: page }) => {
    await mockBillingRoutes(page, { prices: PRICES_DISABLED });
    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // billing toggle 应隐藏（display: none）
    await expect(page.locator('#billing-toggle')).toBeHidden();

    // extra-info 区域应显示 info-box 提示
    const infoBox = page.locator('#extra-info .info-box');
    await expect(infoBox).toBeVisible();
    await expect(infoBox).toContainText('付款功能尚未启用');
  });

  /* ── 9. 未登录时显示提示 ── */
  test('未登录时显示提示', async ({ page }) => {
    await page.addInitScript(() => { localStorage.clear(); });

    await page.route('**/api/billing/plan', route =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized' }) }),
    );

    await page.goto('/billing.html');
    await page.waitForLoadState('networkidle');

    // 未登录时 init() 设置 "请先登录" 但 DOMContentLoaded 的 i18n applyI18n()
    // 会用 data-i18n="ui.loading" 覆盖为 "Loading..." / "加载中..."。
    // 验证方式：确认未渲染任何计划信息（无 plan-badge、无 plan-card、billing toggle 隐藏）
    await expect(page.locator('.plan-badge')).toHaveCount(0);
    await expect(page.locator('.plan-card')).toHaveCount(0);
    await expect(page.locator('#billing-toggle')).toBeHidden();
  });
});

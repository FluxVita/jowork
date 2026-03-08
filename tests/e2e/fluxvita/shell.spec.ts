import { test, expect } from '../fixtures/auth';
import type { Page, Route } from '@playwright/test';

/* ───────────────────────────────────────────────────
 * FluxVita Shell (shell.html) — Deep Interaction Tests
 *
 * shell.html 是主入口 SPA，包含：
 * - 登录蒙层（无 token → location.replace 到 onboarding.html）
 * - 侧边栏导航（品牌区、导航项、底部功能区）
 * - iframe 面板切换（chat / dashboard / admin / logs 等）
 * - 主题切换、语言切换、Gateway 状态指示
 * - 侧边栏折叠/展开
 * ─────────────────────────────────────────────────── */

// ── 共享 mock 数据 ──────────────────────────────────

const MOCK_USER = { user_id: 'usr_e2e_001', name: 'E2E-Test', role: 'admin' };

/** 为 shell.html 设置标准 API mock */
async function setupShellMocks(page: Page) {
  await page.route('**/api/auth/me', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: MOCK_USER }),
    }),
  );

  await page.route('**/api/services/mine', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        services: [
          { service_id: 'svc_page_chat', name: 'Chat', type: 'page' },
          { service_id: 'svc_page_admin', name: 'Admin', type: 'page' },
          { service_id: 'svc_page_ai_services', name: 'AI Services', type: 'page' },
        ],
      }),
    }),
  );

  await page.route('**/health', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );

  // Dev login probe: 返回 hint 以检测 dev mode
  await page.route('**/api/auth/login', (route: Route) => {
    const body = route.request().postDataJSON();
    if (!body || !body.feishu_open_id) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'missing params', hint: 'DEV_DIRECT_LOGIN_ENABLED' }),
      });
    }
    if (body.feishu_open_id && !body.challenge_id) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ challenge_id: 'ch_e2e_001', dev_code: '654321' }),
      });
    }
    if (body.challenge_id) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'e2e-jwt-shell', user: MOCK_USER }),
      });
    }
    return route.continue();
  });

  // Block iframe sub-page loads to keep tests fast
  // (chat.html, dashboard.html etc. loaded via iframe)
  await page.route('**/chat.html*', (route: Route) => {
    // Allow the shell.html itself, block iframe loads
    if (route.request().frame()?.parentFrame()) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Chat Mock</body></html>' });
    }
    return route.continue();
  });

  await page.route('**/dashboard.html*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Dashboard Mock</body></html>' }),
  );

  await page.route('**/admin.html*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Admin Mock</body></html>' }),
  );

  await page.route('**/logs.html*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Logs Mock</body></html>' }),
  );

  await page.route('**/ai-services.html*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>AI Services Mock</body></html>' }),
  );

  await page.route('**/geek.html*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Geek Mock</body></html>' }),
  );

  await page.route('**/files.html*', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Files Mock</body></html>' }),
  );
}

// ═══════════════════════════════════════════════════
// 1. 认证与入口
// ═══════════════════════════════════════════════════

test.describe('Shell — 认证与入口', () => {
  test('已登录时显示主界面和侧边栏', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');

    // #app 应可见（display: flex）
    const app = page.locator('#app');
    await expect(app).toBeVisible({ timeout: 10000 });

    // 侧边栏可见
    await expect(page.locator('.sidebar')).toBeVisible();

    // 登录蒙层不可见
    await expect(page.locator('#login-screen')).not.toBeVisible();
  });

  test('未登录时跳转到 onboarding', async ({ page }) => {
    // 清除所有 token — 不使用 fluxvitaPage fixture
    await page.addInitScript(() => {
      localStorage.clear();
    });

    // shell.html 的逻辑：无 token → location.replace('/onboarding.html')
    await page.goto('/shell.html');

    // 应跳转到 onboarding
    await page.waitForURL('**/onboarding.html', { timeout: 8000 });
  });

  test('auth/me 验证失败时跳转到 onboarding', async ({ fluxvitaPage: page }) => {
    // Mock auth/me 返回 401
    await page.route('**/api/auth/me', (route: Route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' }),
    );

    await page.goto('/shell.html');

    // Token 无效 → 清除后跳转 onboarding
    await page.waitForURL('**/onboarding.html', { timeout: 8000 });
  });
});

// ═══════════════════════════════════════════════════
// 2. 侧边栏导航
// ═══════════════════════════════════════════════════

test.describe('Shell — 侧边栏导航', () => {
  test('侧边栏导航项可见', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 至少有 3 个导航项
    const navItems = page.locator('.nav-item');
    const count = await navItems.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // 默认应有一个 active 导航项（chat）
    const activeItem = page.locator('.nav-item.active');
    await expect(activeItem).toHaveCount(1);
    await expect(activeItem).toHaveAttribute('data-panel', 'chat');
  });

  test('点击导航项切换面板', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 初始 active 是 chat
    await expect(page.locator('.nav-item[data-panel="chat"]')).toHaveClass(/active/);
    await expect(page.locator('#frame-chat')).toHaveClass(/active/);

    // 点击 dashboard 导航项
    await page.locator('.nav-item[data-panel="dashboard"]').click();

    // dashboard 变 active，chat 不再 active
    await expect(page.locator('.nav-item[data-panel="dashboard"]')).toHaveClass(/active/);
    await expect(page.locator('.nav-item[data-panel="chat"]')).not.toHaveClass(/active/);

    // 对应的 iframe 面板切换
    await expect(page.locator('#frame-dashboard')).toHaveClass(/active/);
    await expect(page.locator('#frame-chat')).not.toHaveClass(/active/);

    // 切换到 logs
    await page.locator('.nav-item[data-panel="logs"]').click();
    await expect(page.locator('.nav-item[data-panel="logs"]')).toHaveClass(/active/);
    await expect(page.locator('#frame-logs')).toHaveClass(/active/);

    // 之前的面板不再 active
    await expect(page.locator('#frame-dashboard')).not.toHaveClass(/active/);
  });

  test('导航组标签可见', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 应有导航组标签（"工作台"、"管理"等）
    const labels = page.locator('.nav-group-label');
    const labelCount = await labels.count();
    expect(labelCount).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════
// 3. 品牌区
// ═══════════════════════════════════════════════════

test.describe('Shell — 品牌区', () => {
  test('品牌 Logo 可见', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // brand-logo 可见
    await expect(page.locator('#brand-logo')).toBeVisible();
    await expect(page.locator('#brand-logo')).toHaveAttribute('src', '/app-icon.png');
  });

  test('品牌名称和副标题', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.brand-name')).toContainText('FluxVita');
    await expect(page.locator('.brand-sub')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════
// 4. 主题切换
// ═══════════════════════════════════════════════════

test.describe('Shell — 主题切换', () => {
  test('主题切换按钮改变 data-theme', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 找到主题切换按钮（onclick="toggleTheme()"）
    const themeBtn = page.locator('.action-btn[onclick="toggleTheme()"]');
    await expect(themeBtn).toBeVisible();

    // ThemeManager 使用 localStorage 保存偏好，默认 'dark'。
    // applyTheme('dark') 会 removeAttribute('data-theme')（null），
    // applyTheme('light') 会 setAttribute('data-theme', 'light')。
    // toggle 循环: dark → auto → (light|dark 取决于 system) → ...
    // 用 JS 评估 ThemeManager.getPreference() 来跟踪偏好变化
    const getPref = () => page.evaluate(() => (window as any).ThemeManager.getPreference());

    const pref0 = await getPref();

    // 第一次点击切换
    await themeBtn.click();
    const pref1 = await getPref();
    expect(pref1).not.toBe(pref0);

    // 第二次点击应继续循环
    await themeBtn.click();
    const pref2 = await getPref();
    expect(pref2).not.toBe(pref1);
  });
});

// ═══════════════════════════════════════════════════
// 5. 用户信息
// ═══════════════════════════════════════════════════

test.describe('Shell — 用户信息', () => {
  test('用户名和头像显示', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 用户名显示
    const userChip = page.locator('#user-chip');
    await expect(userChip).toContainText('E2E-Test', { timeout: 5000 });

    // 头像显示首字母
    const avatar = page.locator('#user-avatar');
    await expect(avatar).toContainText('E');
  });

  test('Gateway 状态指示器', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 状态圆点存在
    const dot = page.locator('#status-dot');
    await expect(dot).toBeVisible();

    // health mock 返回 200 → 应变为 online
    await expect(dot).toHaveClass(/online/, { timeout: 8000 });
  });

  test('Gateway 离线时显示 offline banner', async ({ fluxvitaPage: page }) => {
    // Mock health 返回失败
    await page.route('**/health', (route: Route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' }),
    );

    await setupShellMocks(page);

    // 重新 mock health 为失败（setupShellMocks 中的 200 被后注册的覆盖）
    await page.route('**/health', (route: Route) =>
      route.abort('connectionfailed'),
    );

    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 状态圆点应为 offline
    const dot = page.locator('#status-dot');
    await expect(dot).toHaveClass(/offline/, { timeout: 8000 });

    // Offline banner 应显示
    const banner = page.locator('#offline-banner');
    await expect(banner).toBeVisible({ timeout: 8000 });

    // banner 包含重试按钮
    await expect(banner.locator('.offline-retry')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════
// 6. 侧边栏折叠/展开
// ═══════════════════════════════════════════════════

test.describe('Shell — 侧边栏折叠', () => {
  test('折叠按钮切换侧边栏宽度', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);

    // 确保初始非折叠状态
    await page.addInitScript(() => {
      localStorage.removeItem('fv_sidebar_collapsed');
    });

    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    const sidebar = page.locator('.sidebar');
    const collapseBtn = page.locator('#collapse-btn');

    // 初始不折叠
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // 品牌文字可见
    await expect(page.locator('.brand-text')).toBeVisible();

    // 点击折叠
    await collapseBtn.click();

    // 侧边栏获得 collapsed class
    await expect(sidebar).toHaveClass(/collapsed/);

    // 品牌文字隐藏
    await expect(page.locator('.brand-text')).not.toBeVisible();

    // 导航项标签文字（非 icon）在折叠时因 font-size: 0 不可读
    // 但 nav-item 本身仍可见
    await expect(page.locator('.nav-item').first()).toBeVisible();
  });

  test('折叠状态下 logo 点击展开', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);

    // 预设折叠状态
    await page.addInitScript(() => {
      localStorage.setItem('fv_sidebar_collapsed', '1');
    });

    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 应为折叠状态
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/);

    // 点击 logo 展开
    await page.locator('#brand-logo').click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/, { timeout: 3000 });
  });

  test('折叠状态跨刷新保持', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);

    // 预设折叠
    await page.addInitScript(() => {
      localStorage.setItem('fv_sidebar_collapsed', '1');
    });

    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 应仍为折叠
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/);
  });
});

// ═══════════════════════════════════════════════════
// 7. 键盘快捷键
// ═══════════════════════════════════════════════════

test.describe('Shell — 键盘快捷键', () => {
  test('Cmd/Ctrl+1~4 切换面板', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 初始 chat 面板
    await expect(page.locator('.nav-item[data-panel="chat"]')).toHaveClass(/active/);

    // Ctrl+2 → dashboard
    await page.keyboard.press('Control+2');
    await expect(page.locator('.nav-item[data-panel="dashboard"]')).toHaveClass(/active/, { timeout: 3000 });

    // Ctrl+1 → chat
    await page.keyboard.press('Control+1');
    await expect(page.locator('.nav-item[data-panel="chat"]')).toHaveClass(/active/, { timeout: 3000 });
  });

  test('Cmd/Ctrl+\\ 折叠侧边栏', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.addInitScript(() => {
      localStorage.removeItem('fv_sidebar_collapsed');
    });
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 初始展开
    await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/);

    // Ctrl+\ 折叠
    await page.keyboard.press('Control+\\');
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/, { timeout: 3000 });

    // 再按一次展开
    await page.keyboard.press('Control+\\');
    await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════
// 8. 底部功能区
// ═══════════════════════════════════════════════════

test.describe('Shell — 底部功能区', () => {
  test('功能按钮均可见', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 底部功能区
    const actions = page.locator('.sidebar-actions .action-btn');
    const actionCount = await actions.count();

    // 应至少有 4 个（主题、语言、刷新、退出）
    expect(actionCount).toBeGreaterThanOrEqual(4);

    // 每个按钮都可见
    for (let i = 0; i < actionCount; i++) {
      await expect(actions.nth(i)).toBeVisible();
    }
  });

  test('退出按钮跳转到 onboarding', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 点击退出按钮
    const logoutBtn = page.locator('.action-btn.danger');
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // 应跳转到 onboarding
    await page.waitForURL('**/onboarding.html', { timeout: 8000 });
  });
});

// ═══════════════════════════════════════════════════
// 9. 面板 Tab 栏
// ═══════════════════════════════════════════════════

test.describe('Shell — Tab 栏', () => {
  test('AI 助手面板有子 tab 栏', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 切到 chat 面板时 tabbar 应可见
    await expect(page.locator('.nav-item[data-panel="chat"]')).toHaveClass(/active/);
    const tabbar = page.locator('#panel-tabbar');
    await expect(tabbar).toHaveClass(/visible/);

    // 应有 AI 对话 和 极客模式 两个 tab
    const chatTab = page.locator('#tab-chat');
    const geekTab = page.locator('#tab-geek');
    await expect(chatTab).toBeVisible();
    await expect(geekTab).toBeVisible();

    // 默认 chat tab active
    await expect(chatTab).toHaveClass(/active/);
  });

  test('切换到非 chat 面板时 tab 栏行为', async ({ fluxvitaPage: page }) => {
    await setupShellMocks(page);
    await page.goto('/shell.html');
    await expect(page.locator('#app')).toBeVisible({ timeout: 10000 });

    // 切到 dashboard
    await page.locator('.nav-item[data-panel="dashboard"]').click();

    // tab 栏在无打开文件时不可见
    // (tabbar visible 条件: name === 'chat' || openFileTabs.size > 0)
    const tabbar = page.locator('#panel-tabbar');
    await expect(tabbar).not.toHaveClass(/visible/);
  });
});

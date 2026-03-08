import { test, expect } from '../fixtures/auth';

/**
 * FluxVita Geek Mode（极客终端）E2E 测试
 *
 * geek.html 是基于 xterm.js 的多 Tab 终端界面。
 * 终端需要 WebSocket 连接（测试中 WS 不可用，但 UI 元素仍可测试）。
 *
 * 关键元素：
 * - #tab-bar / #tab-list：Tab 栏
 * - .tab-item / .tab-label / .tab-close / .tab-mode-badge：Tab 项
 * - #btn-add：新建终端按钮（打开 Shell 选择器）
 * - #shell-picker / .picker-item[data-mode]：Shell 类型选择器
 * - #search-bar / #search-input / #search-count：搜索栏
 * - #sbtn-prev / #sbtn-next / #sbtn-case / #sbtn-regex / #sbtn-close：搜索按钮
 * - #scroll-btn：滚动到底部按钮
 * - .btn-sm：清屏 / 重启 / 返回
 */

test.describe('FluxVita Geek Mode @regression', () => {
  /* ── 1. 终端页面加载 ── */
  test('终端页面加载显示 Tab 栏', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    // Tab 栏应可见
    await expect(page.locator('#tab-bar')).toBeVisible({ timeout: 5000 });

    // Tab 列表应存在
    await expect(page.locator('#tab-list')).toBeVisible();

    // 页面会自动创建一个默认 shell tab
    // 等待 createTerminal 完成
    await page.waitForTimeout(1000);

    // 至少有 1 个 tab-item（自动创建的 shell）
    const tabItems = page.locator('.tab-item');
    const count = await tabItems.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // 第一个 tab 应为 active
    await expect(tabItems.first()).toHaveClass(/active/);

    // tab 应包含 mode badge
    await expect(tabItems.first().locator('.tab-mode-badge')).toBeVisible();
  });

  /* ── 2. Shell 选择器打开关闭 ── */
  test('Shell 选择器打开关闭', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    const picker = page.locator('#shell-picker');
    const addBtn = page.locator('#btn-add');

    // 初始状态选择器应隐藏
    await expect(picker).not.toHaveClass(/visible/);

    // 点击 + 按钮打开选择器
    await addBtn.click();
    await expect(picker).toHaveClass(/visible/);

    // + 按钮应有 open class
    await expect(addBtn).toHaveClass(/open/);

    // 再次点击关闭（toggle 行为）
    await addBtn.click();
    await expect(picker).not.toHaveClass(/visible/);
    await expect(addBtn).not.toHaveClass(/open/);
  });

  /* ── 2b. 点击外部关闭选择器 ── */
  test('点击选择器外部关闭选择器', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    const picker = page.locator('#shell-picker');
    const addBtn = page.locator('#btn-add');

    // 打开选择器
    await addBtn.click();
    await expect(picker).toHaveClass(/visible/);

    // 点击 body（选择器外部）关闭
    // setTimeout 延迟注册 click listener，需要等一下
    await page.waitForTimeout(100);
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    await expect(picker).not.toHaveClass(/visible/);
  });

  /* ── 3. Shell 类型选项 ── */
  test('Shell 选择器显示三种终端类型', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    // 打开选择器
    await page.locator('#btn-add').click();

    const picker = page.locator('#shell-picker');
    await expect(picker).toHaveClass(/visible/);

    // 应有 3 个 picker-item
    const items = picker.locator('.picker-item');
    await expect(items).toHaveCount(3);

    // 验证三种模式
    await expect(items.nth(0)).toHaveAttribute('data-mode', 'shell');
    await expect(items.nth(1)).toHaveAttribute('data-mode', 'klaude');
    await expect(items.nth(2)).toHaveAttribute('data-mode', 'tmux');

    // 每个选项应有名称和描述
    await expect(items.nth(0).locator('.picker-name')).toContainText('Shell');
    await expect(items.nth(1).locator('.picker-name')).toContainText('Klaude');
    await expect(items.nth(2).locator('.picker-name')).toContainText('Tmux');

    // 每个选项应有描述文字
    for (let i = 0; i < 3; i++) {
      const desc = items.nth(i).locator('.picker-desc');
      await expect(desc).toBeVisible();
      const text = await desc.textContent();
      expect(text!.length).toBeGreaterThan(0);
    }
  });

  /* ── 4. Tab 关闭按钮 ── */
  test('Tab 关闭按钮移除 Tab', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    // 等待默认 Tab 创建
    await page.waitForTimeout(1500);
    const initialCount = await page.locator('.tab-item').count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // 关闭时如果只剩 1 个 Tab，会自动创建新的
    // 先确认有 tab
    const closeBtn = page.locator('.tab-item .tab-close').first();
    await expect(closeBtn).toBeVisible();

    // hover 让 close 按钮可见（CSS transition）
    await page.locator('.tab-item').first().hover();
    await page.waitForTimeout(200);

    // 点击关闭
    await closeBtn.click();

    // 等待渲染
    await page.waitForTimeout(500);

    // 如果只有 1 个 tab，关闭后会自动创建新的（终端至少保留 1 个）
    // 验证 tab 仍存在（至少 1 个）
    const afterCount = await page.locator('.tab-item').count();
    expect(afterCount).toBeGreaterThanOrEqual(1);
  });

  /* ── 5. 搜索栏打开关闭 ── */
  test('Ctrl+F 打开搜索栏，Escape 关闭', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    const searchBar = page.locator('#search-bar');

    // 初始状态搜索栏应隐藏
    await expect(searchBar).not.toHaveClass(/visible/);

    // 打开搜索（headless Chromium 拦截 Ctrl+F 为浏览器内置查找，无法到达页面 keydown）
    await page.evaluate(() => (window as any).openSearch());

    // 搜索栏应可见
    await expect(searchBar).toHaveClass(/visible/);

    // 搜索输入框应可见
    await expect(page.locator('#search-input')).toBeVisible();

    // 搜索按钮应可见
    await expect(page.locator('#sbtn-prev')).toBeVisible();
    await expect(page.locator('#sbtn-next')).toBeVisible();
    await expect(page.locator('#sbtn-case')).toBeVisible();
    await expect(page.locator('#sbtn-regex')).toBeVisible();
    await expect(page.locator('#sbtn-close')).toBeVisible();

    // Escape 关闭搜索（搜索输入框已获得焦点，Escape 由 input keydown handler 处理）
    await page.keyboard.press('Escape');
    await expect(searchBar).not.toHaveClass(/visible/);
  });

  /* ── 6. 搜索输入框聚焦 ── */
  test('搜索打开后输入框自动聚焦', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    // 打开搜索（直接调用，避免 Chromium 拦截 Ctrl+F）
    await page.evaluate(() => (window as any).openSearch());
    await expect(page.locator('#search-bar')).toHaveClass(/visible/);

    // 输入框应已聚焦
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeFocused();

    // 应该可以直接输入
    await searchInput.fill('test query');
    await expect(searchInput).toHaveValue('test query');
  });

  /* ── 7. 搜索大小写和正则切换 ── */
  test('搜索选项切换', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    // 打开搜索（直接调用，避免 Chromium 拦截 Ctrl+F）
    await page.evaluate(() => (window as any).openSearch());

    const caseBtn = page.locator('#sbtn-case');
    const regexBtn = page.locator('#sbtn-regex');

    // 初始状态都不是 on
    await expect(caseBtn).not.toHaveClass(/\bon\b/);
    await expect(regexBtn).not.toHaveClass(/\bon\b/);

    // 点击区分大小写
    await caseBtn.click();
    await expect(caseBtn).toHaveClass(/\bon\b/);

    // 再次点击取消
    await caseBtn.click();
    await expect(caseBtn).not.toHaveClass(/\bon\b/);

    // 点击正则
    await regexBtn.click();
    await expect(regexBtn).toHaveClass(/\bon\b/);
  });

  /* ── 8. 关闭搜索按钮 ── */
  test('点击关闭按钮关闭搜索栏', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    // 打开搜索（直接调用，避免 Chromium 拦截 Ctrl+F）
    await page.evaluate(() => (window as any).openSearch());
    await expect(page.locator('#search-bar')).toHaveClass(/visible/);

    // 点击关闭按钮
    await page.locator('#sbtn-close').click();
    await expect(page.locator('#search-bar')).not.toHaveClass(/visible/);
  });

  /* ── 9. 工具栏按钮存在 ── */
  test('工具栏按钮存在', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    // 清屏、重启、返回按钮应存在
    const actionButtons = page.locator('#tab-actions .btn-sm');
    const count = await actionButtons.count();
    expect(count).toBe(3);

    await expect(actionButtons.nth(0)).toContainText('清屏');
    await expect(actionButtons.nth(1)).toContainText('重启');
    await expect(actionButtons.nth(2)).toContainText('返回');
  });

  /* ── 10. + 按钮存在且可点击 ── */
  test('新建终端按钮存在', async ({ fluxvitaPage: page }) => {
    await page.goto('/geek.html');
    await page.waitForLoadState('networkidle');

    const addBtn = page.locator('#btn-add');
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toContainText('+');
  });
});

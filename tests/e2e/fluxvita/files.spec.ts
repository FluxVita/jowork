import { test, expect } from '../fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * FluxVita Files 文件管理器 E2E 测试
 *
 * files.html 是一个文件树浏览器 + tab 式文件预览器。
 * 使用 fluxvita_token 认证（通过 postMessage 或 localStorage 降级）。
 *
 * 关键元素：
 * - #home-btn：回到主目录
 * - #tree-root：文件树容器
 * - .tree-node / .tree-row：树节点
 * - #tree-path：路径显示
 * - #empty-state：空状态提示
 * - #tab-bar / #content-panel：文件预览区（侧边栏模式下隐藏）
 */

/* ── 共用 mock 数据 ── */
const HOME_RESPONSE = { path: '/home/user', name: 'user' };

const DIR_ENTRIES = {
  entries: [
    { name: 'docs', path: '/home/user/docs', is_dir: true, ext: '' },
    { name: 'src', path: '/home/user/src', is_dir: true, ext: '' },
    { name: 'readme.md', path: '/home/user/readme.md', is_dir: false, ext: 'md' },
    { name: 'index.html', path: '/home/user/index.html', is_dir: false, ext: 'html' },
    { name: 'config.json', path: '/home/user/config.json', is_dir: false, ext: 'json' },
  ],
};

const SUBDIR_ENTRIES = {
  entries: [
    { name: 'guide.md', path: '/home/user/docs/guide.md', is_dir: false, ext: 'md' },
    { name: 'api.md', path: '/home/user/docs/api.md', is_dir: false, ext: 'md' },
  ],
};

const EMPTY_DIR = { entries: [] };

/** 注册文件系统 API mock */
async function mockFileRoutes(
  page: Page,
  opts: { home?: object; rootDir?: object; subDir?: object } = {},
) {
  await page.route('**/api/files/home', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(opts.home ?? HOME_RESPONSE),
    }),
  );

  // 子目录请求根据 path 参数区分响应
  await page.route('**/api/files/dir**', route => {
    const url = route.request().url();
    const isSubDir = url.includes('docs') || url.includes('src');
    const body = isSubDir
      ? JSON.stringify(opts.subDir ?? SUBDIR_ENTRIES)
      : JSON.stringify(opts.rootDir ?? DIR_ENTRIES);
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

test.describe('FluxVita Files @regression', () => {
  /* ── 1. 文件页面加载显示树 ── */
  test('文件页面加载显示树', async ({ fluxvitaPage: page }) => {
    await mockFileRoutes(page);
    await page.goto('/files.html');
    await page.waitForLoadState('networkidle');

    // 树面板应可见
    await expect(page.locator('#tree-panel')).toBeVisible();

    // 树根容器应有内容（至少 1 个 tree-node）
    const nodes = page.locator('#tree-root .tree-node');
    await expect(nodes.first()).toBeVisible({ timeout: 5000 });
    const count = await nodes.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // 工具栏应可见
    await expect(page.locator('#tree-toolbar')).toBeVisible();
  });

  /* ── 2. Home 按钮存在且可点击 ── */
  test('Home 按钮存在且可点击', async ({ fluxvitaPage: page }) => {
    await mockFileRoutes(page);
    await page.goto('/files.html');
    await page.waitForLoadState('networkidle');

    const homeBtn = page.locator('#home-btn');
    await expect(homeBtn).toBeVisible();
    await expect(homeBtn).toBeEnabled();

    // 点击 Home 按钮应重新加载根目录
    await homeBtn.click();

    // 树路径应包含用户目录信息
    await page.waitForTimeout(300);
    const treePath = page.locator('#tree-path');
    await expect(treePath).toBeVisible();
  });

  /* ── 3. 目录展开收起 ── */
  test('目录展开收起', async ({ fluxvitaPage: page }) => {
    await mockFileRoutes(page);
    await page.goto('/files.html');
    await page.waitForLoadState('networkidle');

    // 等待树加载
    await expect(page.locator('#tree-root .tree-node').first()).toBeVisible({ timeout: 5000 });

    // 找到目录节点（docs）
    const dirNode = page.locator('.tree-node.is-dir').first();
    await expect(dirNode).toBeVisible();

    // 确认 toggle 箭头存在（使用 > 直接子选择器避免匹配子节点内的元素）
    const toggle = dirNode.locator('> .tree-row .tree-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toHaveClass(/open/);

    // 点击目录行展开（使用 > 直接子选择器）
    await dirNode.locator('> .tree-row').click();

    // toggle 应变为 open 状态
    await expect(toggle).toHaveClass(/open/);

    // 子目录内容应加载（.tree-children 不再 hidden）
    const children = dirNode.locator('> .tree-children');
    await expect(children).not.toBeHidden({ timeout: 3000 });

    // 子节点应出现
    const childNodes = children.locator('.tree-node');
    await expect(childNodes.first()).toBeVisible({ timeout: 3000 });

    // 再次点击折叠（使用 > 直接子选择器）
    await dirNode.locator('> .tree-row').click();

    // toggle 应移除 open
    await expect(toggle).not.toHaveClass(/open/);

    // 子目录应隐藏
    await expect(children).toBeHidden();
  });

  /* ── 4. 文件选择高亮 ── */
  test('文件选择高亮', async ({ fluxvitaPage: page }) => {
    await mockFileRoutes(page);
    await page.goto('/files.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#tree-root .tree-node').first()).toBeVisible({ timeout: 5000 });

    // 找到一个文件节点（非目录）
    const fileNode = page.locator('.tree-node:not(.is-dir)').first();
    await expect(fileNode).toBeVisible();

    // 初始状态不应有 selected class
    await expect(fileNode).not.toHaveClass(/selected/);

    // 点击文件节点
    await fileNode.locator('.tree-row').click();

    // 应获得 selected class
    await expect(fileNode).toHaveClass(/selected/);

    // 点击另一个文件节点
    const secondFile = page.locator('.tree-node:not(.is-dir)').nth(1);
    if (await secondFile.isVisible()) {
      await secondFile.locator('.tree-row').click();

      // 第二个文件应选中
      await expect(secondFile).toHaveClass(/selected/);

      // 第一个文件应取消选中
      await expect(fileNode).not.toHaveClass(/selected/);
    }
  });

  /* ── 5. 空目录状态 ── */
  test('空目录显示空状态', async ({ fluxvitaPage: page }) => {
    await mockFileRoutes(page, { rootDir: EMPTY_DIR });
    await page.goto('/files.html');
    await page.waitForLoadState('networkidle');

    // 等待加载完成
    await page.waitForTimeout(1000);

    // 树根应包含空目录提示
    const treeRoot = page.locator('#tree-root');
    await expect(treeRoot).toContainText('空目录');
  });

  /* ── 6. 路径显示更新 ── */
  test('路径显示初始化正确', async ({ fluxvitaPage: page }) => {
    await mockFileRoutes(page);
    await page.goto('/files.html');
    await page.waitForLoadState('networkidle');

    // 等待树加载完成
    await expect(page.locator('#tree-root .tree-node').first()).toBeVisible({ timeout: 5000 });

    // tree-path 应显示路径信息（不再是 "加载中..."）
    const treePath = page.locator('#tree-path');
    await expect(treePath).not.toContainText('加载中');

    // 应包含用户目录名
    const pathText = await treePath.textContent();
    expect(pathText).toBeTruthy();
    expect(pathText!.length).toBeGreaterThan(0);
  });

  /* ── 7. 键盘导航 ── */
  test('键盘上下箭头导航节点', async ({ fluxvitaPage: page }) => {
    await mockFileRoutes(page);
    await page.goto('/files.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#tree-root .tree-node').first()).toBeVisible({ timeout: 5000 });

    // 使用文件节点避免触发目录展开（目录点击会展开并插入子节点）
    const fileNodes = page.locator('#tree-root > .tree-node:not(.is-dir)');
    const firstFile = fileNodes.first();
    await firstFile.locator('.tree-row').click();
    await expect(firstFile).toHaveClass(/selected/);

    // 按下箭头移动到下一个节点
    await firstFile.press('ArrowDown');

    // 下一个文件节点应获取焦点和选中
    const secondFile = fileNodes.nth(1);
    await expect(secondFile).toHaveClass(/selected/, { timeout: 3000 });
  });

  /* ── 8. 目录展开后图标变化 ── */
  test('目录展开后图标从文件夹变为打开状态', async ({ fluxvitaPage: page }) => {
    await mockFileRoutes(page);
    await page.goto('/files.html');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('#tree-root .tree-node').first()).toBeVisible({ timeout: 5000 });

    const dirNode = page.locator('.tree-node.is-dir').first();
    // 使用 > 直接子选择器，避免展开后匹配到子节点的图标
    const icon = dirNode.locator('> .tree-row .tree-icon');

    // 未展开时图标应为关闭文件夹
    const closedIcon = await icon.textContent();

    // 点击展开（使用 > 直接子选择器）
    await dirNode.locator('> .tree-row').click();
    await page.waitForTimeout(300);

    // 展开后图标应变化
    const openIcon = await icon.textContent();
    // 关闭时是 📁，打开后是 📂
    expect(closedIcon).not.toBe(openIcon);
  });
});

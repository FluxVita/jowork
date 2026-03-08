import { test, expect } from '../fixtures/auth';
import type { Page } from '@playwright/test';

/**
 * Jowork AI Services 页面 E2E 测试
 *
 * ai-services.html 管理 AI 服务（Klaude、API Providers、MCP、Skills、Agent Browser）。
 * Token 通过 hash/localStorage jowork_token 注入。
 */

async function setupAiServicesMocks(page: Page, overrides?: {
  klaudeStatus?: string;
  klaudePid?: number | null;
  providers?: Array<{ id: string; enabled: boolean; key_is_set: boolean; key_source: string | null; circuit_open: boolean; models: string[] }>;
  mcpServers?: Array<{ name: string; command: string; status: string; enabled: boolean }>;
}) {
  const klaudeStatus = overrides?.klaudeStatus ?? 'stopped';
  const klaudePid = overrides?.klaudePid ?? null;
  const providers = overrides?.providers ?? [
    { id: 'moonshot', enabled: true, key_is_set: true, key_source: 'user', circuit_open: false, models: { chat: 'moonshot-v1-128k' } },
    { id: 'minimax', enabled: false, key_is_set: false, key_source: null, circuit_open: false, models: {} },
  ];
  const mcpServers = overrides?.mcpServers ?? [];

  await page.route('**/api/ai-services/klaude/status', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: klaudeStatus,
        bin_exists: true,
        bin_mtime: '2026-01-01T00:00:00Z',
        port: 8899,
        pid: klaudePid,
        started_at: klaudePid ? '2026-03-01T10:00:00Z' : null,
      }),
    }),
  );
  await page.route('**/api/ai-services/klaude/logs', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ logs: 'Starting server...\n[INFO] Ready on port 8899\n[INFO] Health check passed' }),
    }),
  );
  await page.route('**/api/ai-services/klaude/sync', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }),
  );
  await page.route('**/api/ai-services/klaude/start', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, pid: 12345 }),
    }),
  );
  await page.route('**/api/models/providers', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(providers),
    }),
  );
  await page.route('**/api/agent/mcp-servers', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mcpServers),
    }),
  );
  await page.route('**/api/agent/mcp-servers/add', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }),
  );
  await page.route('**/api/agent/skills', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );
  await page.route('**/api/ai-services/agent-browser/status', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ installed: false }),
    }),
  );
  await page.route('**/api/ai-services/provider/*/key', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }),
  );
  await page.route('**/api/ai-services/provider/*/toggle', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }),
  );
}

test.describe('Jowork AI Services - Deep Interaction Tests', () => {

  // ── Test 1: Page loads with service cards ──
  test('AI 服务页面加载 -- page loads with service cards', async ({ joworkPage: page }) => {
    await setupAiServicesMocks(page);

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // Page header visible
    await expect(page.locator('.page-header h1')).toBeVisible();

    // Services grid visible
    await expect(page.locator('.services-grid')).toBeVisible();

    // Klaude card visible
    await expect(page.locator('#klaude-card')).toBeVisible();

    // Moonshot and Minimax cards visible
    await expect(page.locator('#moonshot-card')).toBeVisible();
    await expect(page.locator('#minimax-card')).toBeVisible();

    // MCP section exists
    await expect(page.locator('#mcp-add-form')).toBeAttached();
    await expect(page.locator('#mcp-list')).toBeAttached();
  });

  // ── Test 2: Klaude status display ──
  test('Klaude 状态显示 -- badge shows status (running/stopped)', async ({ joworkPage: page }) => {
    await setupAiServicesMocks(page, { klaudeStatus: 'stopped' });

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // Badge should be visible
    const badge = page.locator('#klaude-badge');
    await expect(badge).toBeVisible();

    // Status text should show stopped-related text
    const statusText = page.locator('#klaude-status-text');
    await expect(statusText).toBeVisible();

    // Start button should be visible when stopped
    await expect(page.locator('#klaude-start-btn')).toBeVisible();

    // Sync button should be visible
    await expect(page.locator('#klaude-sync-btn')).toBeVisible();

    // Meta info should be visible
    await expect(page.locator('#klaude-meta')).toBeVisible();
    await expect(page.locator('#klaude-port')).toBeVisible();
  });

  // ── Test 3: Klaude running state ──
  test('Klaude 运行中状态 -- badge shows running', async ({ joworkPage: page }) => {
    await setupAiServicesMocks(page, { klaudeStatus: 'running', klaudePid: 12345 });

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // Badge should show running class
    const badge = page.locator('#klaude-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveClass(/running/);
  });

  // ── Test 4: Klaude log panel toggle ──
  test('Klaude 日志面板切换 -- click toggle -> log panel visible -> click again -> hidden', async ({ joworkPage: page }) => {
    await setupAiServicesMocks(page);

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // Log panel should be hidden by default (no .show class)
    const logPanel = page.locator('#klaude-log-panel');
    await expect(logPanel).not.toHaveClass(/show/);

    // Click toggle button
    const toggleBtn = page.locator('#log-toggle-btn');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    // Log panel should now be visible
    await expect(logPanel).toHaveClass(/show/);

    // Log content area should be visible
    await expect(page.locator('#klaude-log')).toBeVisible();

    // Click toggle again to hide
    await toggleBtn.click();
    await expect(logPanel).not.toHaveClass(/show/);
  });

  // ── Test 5: API Provider cards ──
  test('API Provider 卡片 -- moonshot/minimax cards visible with key inputs', async ({ joworkPage: page }) => {
    await setupAiServicesMocks(page);

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // Moonshot card
    await expect(page.locator('#moonshot-card')).toBeVisible();
    await expect(page.locator('#moonshot-badge')).toBeVisible();
    // Moonshot is configured (key_is_set: true), badge should be running
    await expect(page.locator('#moonshot-badge')).toHaveClass(/running/);

    // Key input for moonshot
    await expect(page.locator('#moonshot-key-input')).toBeVisible();

    // Minimax card
    await expect(page.locator('#minimax-card')).toBeVisible();
    await expect(page.locator('#minimax-badge')).toBeVisible();
    // Minimax is not configured, badge should be stopped
    await expect(page.locator('#minimax-badge')).toHaveClass(/stopped/);

    // Key input for minimax
    await expect(page.locator('#minimax-key-input')).toBeVisible();

    // Enable toggles exist
    await expect(page.locator('#moonshot-enabled')).toBeAttached();
    await expect(page.locator('#minimax-enabled')).toBeAttached();
  });

  // ── Test 6: MCP add form show/hide ──
  test('MCP 添加表单显示隐藏 -- click add -> form shown -> click cancel -> form hidden', async ({ joworkPage: page }) => {
    await setupAiServicesMocks(page);

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // MCP add form should be hidden by default
    const mcpForm = page.locator('#mcp-add-form');
    await expect(mcpForm).toBeHidden();

    // Click "添加 MCP 服务器" button
    await page.locator('button:has-text("添加 MCP 服务器")').click();

    // Form should now be visible
    await expect(mcpForm).toBeVisible();

    // Form fields should be visible
    await expect(page.locator('#mcp-name')).toBeVisible();
    await expect(page.locator('#mcp-command')).toBeVisible();
    await expect(page.locator('#mcp-args')).toBeVisible();
    await expect(page.locator('#mcp-env')).toBeVisible();

    // Cancel button should hide the form
    await page.locator('#mcp-add-form button:has-text("取消")').click();
    await expect(mcpForm).toBeHidden();
  });

  // ── Test 7: MCP server add ──
  test('MCP 服务器添加 -- fill name + command -> click confirm -> API called', async ({ joworkPage: page }) => {
    await setupAiServicesMocks(page);

    let mcpAddCalled = false;
    let mcpAddPayload: string | null = null;
    await page.route('**/api/agent/mcp-servers', route => {
      if (route.request().method() === 'POST') {
        mcpAddCalled = true;
        mcpAddPayload = route.request().postData();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // Open MCP add form
    await page.locator('button:has-text("添加 MCP 服务器")').click();
    await expect(page.locator('#mcp-add-form')).toBeVisible();

    // Fill name
    await page.locator('#mcp-name').click();
    await page.locator('#mcp-name').fill('file-search');
    await expect(page.locator('#mcp-name')).toHaveValue('file-search');

    // Fill command
    await page.locator('#mcp-command').click();
    await page.locator('#mcp-command').fill('npx');
    await expect(page.locator('#mcp-command')).toHaveValue('npx');

    // Fill args
    await page.locator('#mcp-args').click();
    await page.locator('#mcp-args').fill('-y,@modelcontextprotocol/server-filesystem,/tmp');

    // Click confirm
    await page.locator('#mcp-add-form button:has-text("确认添加")').click();

    // Wait for API call
    await page.waitForTimeout(500);
    expect(mcpAddCalled).toBe(true);
    expect(mcpAddPayload).toContain('file-search');
    expect(mcpAddPayload).toContain('npx');
  });

  // ── Test 8: Moonshot key save interaction ──
  test('Moonshot API Key 保存交互 -- fill key -> click save', async ({ joworkPage: page }) => {
    await setupAiServicesMocks(page);

    let keySaveCalled = false;
    await page.route('**/api/models/providers/moonshot/key', route => {
      keySaveCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // Fill moonshot key
    const keyInput = page.locator('#moonshot-key-input');
    await keyInput.click();
    await keyInput.fill('sk-test-moonshot-key-12345');
    await expect(keyInput).toHaveValue('sk-test-moonshot-key-12345');

    // Click save button next to moonshot key input
    await page.locator('#moonshot-card button:has-text("保存")').click();

    // Wait for save
    await page.waitForTimeout(500);
  });

  // ── Test 9: Skills section exists ──
  test('Skills 区域存在 -- skill list and add button visible', async ({ joworkPage: page }) => {
    await setupAiServicesMocks(page);

    await page.goto('/ai-services.html');
    await page.waitForLoadState('networkidle');

    // Skills section should exist
    await expect(page.locator('#skill-list')).toBeAttached();

    // Install button exists
    await expect(page.locator('button:has-text("安装 Skill")')).toBeVisible();

    // Skill add form hidden by default
    await expect(page.locator('#skill-add-form')).toBeHidden();

    // Click install shows form
    await page.locator('button:has-text("安装 Skill")').click();
    await expect(page.locator('#skill-add-form')).toBeVisible();

    // Cancel hides form
    await page.locator('#skill-add-form button:has-text("取消")').click();
    await expect(page.locator('#skill-add-form')).toBeHidden();
  });
});

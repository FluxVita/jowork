import { test, expect } from '../fixtures/auth';

/**
 * Jowork Chat 页面 E2E 深度交互测试
 *
 * 所有 API 路由在 page.goto() 之前 mock，测试真实用户行为。
 * 每个 test 独立，不依赖其他 test 的状态。
 */

/* ── 共用 mock 路由 ── */
function mockChatAPIs(page: import('@playwright/test').Page) {
  return Promise.all([
    page.route('**/api/auth/me', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { user_id: 'usr_1', name: 'Test', role: 'owner' } }),
      }),
    ),
    page.route('**/api/agent/sessions', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [
              { session_id: 's1', title: 'Test Session', updated_at: '2026-03-01T10:00:00Z' },
              { session_id: 's2', title: 'Another Chat', updated_at: '2026-03-01T09:00:00Z' },
            ],
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }),
    page.route('**/api/agent/sessions/s1', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: [
            { id: 'm1', role: 'user', content: 'Hello' },
            { id: 'm2', role: 'assistant', content: 'Hi there!' },
          ],
        }),
      }),
    ),
    page.route('**/api/agent/sessions/s2', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: [
            { id: 'm3', role: 'user', content: 'Question about Another Chat' },
            { id: 'm4', role: 'assistant', content: 'Sure, let me help.' },
          ],
        }),
      }),
    ),
    page.route('**/api/agent/engines', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          engines: [
            { id: 'builtin', name: 'Built-in', active: true },
            { id: 'claude_agent', name: 'Claude', active: false },
          ],
        }),
      }),
    ),
    page.route('**/api/agent/engine', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    ),
    page.route('**/api/billing/credits', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 1000, used: 200, remaining: 800 }),
      }),
    ),
    page.route('**/api/agent/workstyle', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ content: '# Work Style\nI prefer concise answers' }),
        });
      }
      // PUT
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }),
    page.route('**/api/agent/chat', route =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"type":"text_done","content":"Mock reply from AI"}\n\n',
      }),
    ),
    page.route('**/api/agent/feedback', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }),
    ),
  ]);
}

/* ═══════════════════════════════════════════
   未登录态
   ═══════════════════════════════════════════ */
test.describe('Jowork Chat 未登录态', () => {
  test('未登录显示登录界面', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });

    await mockChatAPIs(page);

    // 让 /api/auth/me 返回 401，模拟未认证
    await page.route('**/api/auth/me', route =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) }),
    );

    await page.goto('/chat.html');

    // 登录界面可见
    const loginScreen = page.locator('#login-screen');
    await expect(loginScreen).toBeVisible({ timeout: 5000 });

    // 聊天界面不可见
    const chatScreen = page.locator('#chat-screen');
    await expect(chatScreen).toBeHidden();
  });

  test('Dev 登录链接显示表单', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });

    await page.route('**/api/auth/me', route =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) }),
    );

    await page.goto('/chat.html');
    await expect(page.locator('#login-screen')).toBeVisible({ timeout: 5000 });

    // dev-form 初始应隐藏
    const devForm = page.locator('#dev-form');
    await expect(devForm).toBeHidden();

    // 点击 dev login 链接
    await page.locator('.dev-login a').click();

    // 表单应可见
    await expect(devForm).toBeVisible();
    await expect(page.locator('#dev-open-id')).toBeVisible();
    await expect(page.locator('#dev-name')).toBeVisible();
  });
});

/* ═══════════════════════════════════════════
   已登录态
   ═══════════════════════════════════════════ */
test.describe('Jowork Chat 已登录态 @smoke', () => {
  test.beforeEach(async ({ joworkPage: page }) => {
    await mockChatAPIs(page);
  });

  test('登录后显示聊天界面', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');

    const chatScreen = page.locator('#chat-screen');
    await expect(chatScreen).toBeVisible({ timeout: 5000 });

    const loginScreen = page.locator('#login-screen');
    await expect(loginScreen).toBeHidden();
  });

  test('欢迎消息可见', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    const welcome = page.locator('.message.welcome');
    await expect(welcome).toBeVisible({ timeout: 5000 });

    // 确认有 greeting 文本
    await expect(welcome.locator('h2')).toBeVisible();
  });

  test('快速提问按钮填充输入', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    const welcome = page.locator('.message.welcome');
    await expect(welcome).toBeVisible({ timeout: 5000 });

    // 点击第一个 hint span
    const firstHint = welcome.locator('.hint span').first();
    const hintText = await firstHint.textContent();
    await firstHint.click();

    // quickAsk() sets input then immediately calls sendMessage() which clears it,
    // so we assert the user message bubble appeared instead of checking input value
    const userMsg = page.locator('.message.user').last();
    await expect(userMsg).toBeVisible({ timeout: 5000 });
    await expect(userMsg).toContainText(hintText!.trim());
  });

  test('新建对话按钮', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // 先在输入框中输入一些文字，模拟有活跃内容
    const textarea = page.locator('textarea#input');
    await textarea.fill('some text');

    // 点击新建对话
    await page.locator('.new-chat-btn').click();

    // welcome 消息应重新出现
    const welcome = page.locator('.message.welcome');
    await expect(welcome).toBeVisible({ timeout: 5000 });
  });

  test('会话列表渲染', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // sidebar 可见
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // 等待 session list 渲染
    const sessionList = page.locator('#session-list');
    await expect(sessionList).toBeVisible();

    // 应有 session item（mock 返回了 2 个）
    const items = page.locator('.session-item');
    await expect(items).toHaveCount(2, { timeout: 5000 });

    // 验证标题
    await expect(items.first()).toContainText('Test Session');
  });

  test('会话搜索', async ({ joworkPage: page }) => {
    // Session search uses a separate API endpoint, not client-side filtering
    await page.route('**/api/agent/sessions/search*', route => {
      const url = new URL(route.request().url());
      const q = url.searchParams.get('q') || '';
      // Return only matching sessions
      const allSessions = [
        { session_id: 's1', title: 'Test Session', updated_at: '2026-03-01T10:00:00Z' },
        { session_id: 's2', title: 'Another Chat', updated_at: '2026-03-01T09:00:00Z' },
      ];
      const filtered = allSessions.filter(s => s.title.toLowerCase().includes(q.toLowerCase()));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: filtered }),
      });
    });

    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // 等待会话列表渲染完成
    await expect(page.locator('.session-item')).toHaveCount(2, { timeout: 5000 });

    // 在搜索框输入
    const searchInput = page.locator('#session-search');
    await searchInput.fill('Another');

    // 等待搜索 API 返回结果（debounce 300ms + network）
    await expect(page.locator('.session-item')).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator('.session-item').first()).toContainText('Another Chat');
  });

  test('切换会话', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // 等待会话列表
    await expect(page.locator('.session-item')).toHaveCount(2, { timeout: 5000 });

    // 点击第一个 session item
    const firstSession = page.locator('.session-item').first();
    await firstSession.click();

    // 应获得 active class
    await expect(firstSession).toHaveClass(/active/);
  });

  test('引擎切换', async ({ joworkPage: page }) => {
    let engineApiCalled = false;
    await page.route('**/api/agent/engine', route => {
      engineApiCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // builtin 默认 active
    const builtinOpt = page.locator('.engine-opt[data-engine="builtin"]');
    await expect(builtinOpt).toHaveClass(/active/);

    // 点击 claude_agent
    const claudeOpt = page.locator('.engine-opt[data-engine="claude_agent"]');
    await claudeOpt.click();

    // claude_agent 获得 active，builtin 失去 active
    await expect(claudeOpt).toHaveClass(/active/);
    await expect(builtinOpt).not.toHaveClass(/active/);
  });

  test('输入框 Enter 发送', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    const textarea = page.locator('textarea#input');
    await textarea.fill('Hello from Enter test');

    // 按 Enter 发送
    await textarea.press('Enter');

    // 用户消息应出现
    const userMsg = page.locator('.message.user').last();
    await expect(userMsg).toBeVisible({ timeout: 5000 });
    await expect(userMsg).toContainText('Hello from Enter test');

    // 输入框应被清空
    await expect(textarea).toHaveValue('');
  });

  test('输入框 Shift+Enter 换行', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    const textarea = page.locator('textarea#input');
    await textarea.fill('Line one');

    // 按 Shift+Enter 应该换行，不应发送
    await textarea.press('Shift+Enter');

    // textarea 应包含换行内容，不应有新消息
    const value = await textarea.inputValue();
    expect(value).toContain('Line one');
    expect(value).toContain('\n');

    // 不应有 user message
    const userMessages = page.locator('.message.user');
    await expect(userMessages).toHaveCount(0);
  });

  test('发送按钮', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    const textarea = page.locator('textarea#input');
    await textarea.fill('Hello from send button');

    // 触发 input 事件让 send-btn 显示（hidden 类通过 updateSendBtn 控制）
    await textarea.dispatchEvent('input');

    // 点击发送按钮
    const sendBtn = page.locator('#send-btn');
    await sendBtn.click({ force: true });

    // 用户消息应出现
    const userMsg = page.locator('.message.user').last();
    await expect(userMsg).toBeVisible({ timeout: 5000 });
    await expect(userMsg).toContainText('Hello from send button');
  });

  test('工作风格模态框打开关闭', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    const modal = page.locator('#workstyle-modal');

    // 初始应隐藏
    await expect(modal).not.toHaveClass(/active/);

    // 点击侧栏按钮打开
    await page.locator('.sidebar-footer-btn').first().click();

    // modal 可见
    await expect(modal).toHaveClass(/active/, { timeout: 3000 });
    await expect(page.locator('#workstyle-editor')).toBeVisible();

    // 点击关闭
    await page.locator('.modal-close').click();

    // modal 隐藏
    await expect(modal).not.toHaveClass(/active/);
  });

  test('工作风格编辑保存', async ({ joworkPage: page }) => {
    let workstyleSaved = false;
    await page.route('**/api/agent/workstyle', route => {
      if (route.request().method() === 'PUT') {
        workstyleSaved = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: '' }),
      });
    });

    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // 打开 modal
    await page.locator('.sidebar-footer-btn').first().click();
    const modal = page.locator('#workstyle-modal');
    await expect(modal).toHaveClass(/active/, { timeout: 3000 });

    // 在 editor 中输入
    const editor = page.locator('#workstyle-editor');
    await editor.fill('I like short answers. No fluff.');

    // 点击保存
    await page.locator('.modal-footer .btn-primary').click();

    // API 应被调用
    expect(workstyleSaved).toBe(true);

    // modal 应关闭
    await expect(modal).not.toHaveClass(/active/, { timeout: 3000 });
  });

  test('Sidebar 可见', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // sidebar 可见
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // 新建对话按钮可见
    await expect(page.locator('.new-chat-btn')).toBeVisible();

    // session list 区域可见
    await expect(page.locator('#session-list')).toBeVisible();
  });
});

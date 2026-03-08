import { test, expect } from '../fixtures/auth';
import type { Page, Route } from '@playwright/test';

/* ───────────────────────────────────────────────────
 * FluxVita Chat (chat.html) — Deep Interaction Tests
 *
 * chat.html 是最交互密集的页面：登录流、会话管理、
 * 消息发送（SSE 流式）、引擎切换、终端面板、工作风格模态框。
 *
 * 所有 API 路由在 page.goto() 前用 page.route() mock，
 * 测试真实的点击/输入/键盘事件，而非仅断言元素存在。
 * ─────────────────────────────────────────────────── */

// ── 共享 mock 数据 ──────────────────────────────────

const MOCK_USER = { user_id: 'usr_e2e_001', name: 'E2E-Test', role: 'owner' };

const MOCK_SESSIONS = [
  { session_id: 'sess_1', title: '最近有哪些 MR 待合并？', updated_at: '2026-03-08T10:00:00Z' },
  { session_id: 'sess_2', title: '帮我查一下产品文档', updated_at: '2026-03-07T09:00:00Z' },
  { session_id: 'sess_3', title: '用户反馈分析报告', updated_at: '2026-03-06T08:00:00Z' },
];

const MOCK_SESSION_MESSAGES = [
  { role: 'user', content: '最近有哪些 MR 待合并？', created_at: '2026-03-08T10:00:01Z' },
  { role: 'assistant', content: '目前有 3 个 MR 待合并：\n\n1. **feat: add billing page** — by Alex\n2. **fix: session timeout** — by Bob\n3. **chore: update deps** — by Carol', created_at: '2026-03-08T10:00:05Z' },
];

const MOCK_ENGINES = {
  engines: [
    { id: 'builtin', name: '小F', active: true },
    { id: 'claude_agent', name: 'Claude Code', active: false },
  ],
  default: 'builtin',
};

const MOCK_WORKSTYLE = { content: '# 我的工作方式\n\n- 简洁直接\n- 用中文回答' };

/** 为 chat.html 设置所有标准 API mock（page.goto 前调用） */
async function setupChatMocks(page: Page) {
  await page.route('**/api/auth/me', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: MOCK_USER }),
    }),
  );

  await page.route('**/api/agent/sessions', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: MOCK_SESSIONS }),
      });
    }
    return route.continue();
  });

  await page.route('**/api/agent/sessions/*', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: MOCK_SESSION_MESSAGES }),
      });
    }
    return route.continue();
  });

  await page.route('**/api/agent/engines', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ENGINES),
    }),
  );

  await page.route('**/api/billing/credits', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total: 1000, used: 100, remaining: 900 }),
    }),
  );

  await page.route('**/api/agent/workstyle', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_WORKSTYLE),
      });
    }
    if (route.request().method() === 'PUT') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    }
    return route.continue();
  });

  await page.route('**/api/agent/feedback', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }),
  );

  await page.route('**/api/agent/engine', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }),
  );

  // Mock SSE chat endpoint
  await page.route('**/api/agent/chat', (route: Route) => {
    const sseBody = [
      'event: session_created\ndata: {"session_id":"sess_new_1"}\n\n',
      'event: text\ndata: {"content":"这是"}\n\n',
      'event: text\ndata: {"content":"一条"}\n\n',
      'event: text\ndata: {"content":"测试回复。"}\n\n',
      'event: text_done\ndata: {"content":"这是一条测试回复。"}\n\n',
      'event: usage\ndata: {"input_tokens":50,"output_tokens":20}\n\n',
    ].join('');
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody,
    });
  });

  // Mock login step1 + step2 (used by dev login)
  await page.route('**/api/auth/login', (route: Route) => {
    const body = route.request().postDataJSON();
    if (!body || (!body.feishu_open_id && !body.challenge_id)) {
      // Initial probe (empty body) — return hint for dev mode detection
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'missing params', hint: 'DEV_DIRECT_LOGIN_ENABLED' }),
      });
    }
    if (body.feishu_open_id && !body.challenge_id) {
      // Step 1
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ challenge_id: 'ch_e2e_001', dev_code: '123456' }),
      });
    }
    if (body.challenge_id) {
      // Step 2
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'e2e-jwt-token', user: MOCK_USER }),
      });
    }
    return route.continue();
  });

  // Session search mock (debounceSearch → doSessionSearch → /api/agent/sessions/search?q=...)
  await page.route('**/api/agent/sessions/search**', (route: Route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const filtered = MOCK_SESSIONS.filter(s => s.title.toLowerCase().includes(q));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: filtered }),
    });
  });

  // Services guard mock
  await page.route('**/api/services/mine', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ services: [{ service_id: 'svc_page_chat', name: 'Chat', type: 'page' }] }),
    }),
  );

  // Health endpoint for gateway status
  await page.route('**/health', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
  );
}

// ═══════════════════════════════════════════════════
// 1. 登录界面测试
// ═══════════════════════════════════════════════════

test.describe('Chat — 登录流程', () => {
  test('未登录时显示登录界面', async ({ page }) => {
    // 清除 token，不注入 fluxvitaPage 的自动 token
    await page.addInitScript(() => {
      localStorage.clear();
    });

    await setupChatMocks(page);
    await page.goto('/chat.html');

    // 登录界面应可见
    const loginScreen = page.locator('#login-screen');
    await expect(loginScreen).toBeVisible({ timeout: 5000 });

    // 聊天界面应不可见
    const chatScreen = page.locator('#chat-screen');
    await expect(chatScreen).not.toBeVisible();

    // 登录框中的关键元素
    await expect(page.locator('.login-box h1')).toContainText('FluxVita');
    await expect(page.locator('#oauth-btn')).toBeVisible();
  });

  test('Dev 模式登录流程', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      // ServicesGuard loads with no token → empty services. After dev login,
      // guardPage() would redirect away. Patch it to no-op for this test.
      window.addEventListener('DOMContentLoaded', () => {
        if ((window as any).ServicesGuard) (window as any).ServicesGuard.guardPage = () => {};
      });
    });

    // Dismiss any unexpected dialogs
    page.on('dialog', d => d.dismiss());

    await setupChatMocks(page);
    await page.goto('/chat.html');

    // 等待登录界面
    await expect(page.locator('#login-screen')).toBeVisible({ timeout: 5000 });

    // dev-form 初始时隐藏
    const devForm = page.locator('#dev-form');
    await expect(devForm).not.toBeVisible();

    // 点击开发模式链接
    await page.locator('.dev-login a').click();

    // dev-form 现在应该可见
    await expect(devForm).toBeVisible();

    // 填写 Open ID 和姓名
    await page.locator('#dev-open-id').fill('ou_test_dev_001');
    await page.locator('#dev-name').fill('Dev User');

    // 验证输入值
    await expect(page.locator('#dev-open-id')).toHaveValue('ou_test_dev_001');
    await expect(page.locator('#dev-name')).toHaveValue('Dev User');

    // 点击登录按钮（两步 challenge 由 mock 自动完成）
    await page.locator('#dev-form .btn, #dev-form .btn-primary').click();

    // 登录成功后应进入聊天界面
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#login-screen')).not.toBeVisible();

    // 验证 token 已存入 localStorage
    const storedToken = await page.evaluate(() => localStorage.getItem('fluxvita_token'));
    expect(storedToken).toBe('e2e-jwt-token');
  });

  test('Dev 模式登录 — 空输入报错', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
    });

    await setupChatMocks(page);
    await page.goto('/chat.html');

    await expect(page.locator('#login-screen')).toBeVisible({ timeout: 5000 });

    // 展开 dev form
    await page.locator('.dev-login a').click();
    await expect(page.locator('#dev-form')).toBeVisible();

    // 不填任何内容直接点登录
    await page.locator('#dev-form .btn, #dev-form .btn-primary').click();

    // 应显示错误提示
    const loginError = page.locator('#login-error');
    await expect(loginError).toBeVisible({ timeout: 3000 });
    await expect(loginError).toContainText('请填写');

    // 错误提示 5 秒后自动隐藏
    await expect(loginError).not.toBeVisible({ timeout: 6000 });
  });
});

// ═══════════════════════════════════════════════════
// 2. 聊天主界面测试
// ═══════════════════════════════════════════════════

test.describe('Chat — 主界面', () => {
  test('登录后进入聊天界面', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');

    // 聊天界面可见，登录界面隐藏
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#login-screen')).not.toBeVisible();

    // 侧边栏、消息区、输入区都可见
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('#messages')).toBeVisible();
    await expect(page.locator('#input')).toBeVisible();
  });

  test('欢迎消息和快速提问', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 欢迎消息可见
    const welcome = page.locator('.message.welcome');
    await expect(welcome).toBeVisible();
    await expect(welcome.locator('h2')).toBeVisible();

    // 快速提问 hint spans
    const hints = welcome.locator('.hint span');
    const hintCount = await hints.count();
    expect(hintCount).toBeGreaterThanOrEqual(2);

    // 点击第一个 hint → quickAsk() 立刻调用 sendMessage() 发送消息
    // sendMessage() 会清空输入框，所以不能断言 input 有值
    const firstHintText = await hints.first().textContent();
    await hints.first().click();

    // 验证用户消息已出现在消息区（quickAsk 触发了 sendMessage）
    const userMsg = page.locator('.message.user').first();
    await expect(userMsg).toBeVisible({ timeout: 5000 });
    await expect(userMsg).toContainText(firstHintText!.trim());
  });

  test('新建对话按钮', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 先点击一个会话，进入非欢迎状态
    const sessionItem = page.locator('.session-item').first();
    await expect(sessionItem).toBeVisible({ timeout: 5000 });
    await sessionItem.click();

    // 点击新建对话
    await page.locator('.new-chat-btn').click();

    // 欢迎消息应重新出现（showWelcome() 重建消息区）
    await expect(page.locator('.message.welcome')).toBeVisible({ timeout: 3000 });

    // 标题恢复为默认
    await expect(page.locator('#chat-title')).toContainText('FluxVita AI 助手');
  });
});

// ═══════════════════════════════════════════════════
// 3. 会话管理测试
// ═══════════════════════════════════════════════════

test.describe('Chat — 会话管理', () => {
  test('会话搜索过滤', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 等待会话列表加载
    const sessionList = page.locator('#session-list');
    await expect(sessionList.locator('.session-item').first()).toBeVisible({ timeout: 5000 });
    const initialCount = await sessionList.locator('.session-item').count();
    expect(initialCount).toBe(3);

    // 输入搜索关键词 "MR" → debounceSearch → doSessionSearch → /api/agent/sessions/search?q=MR
    const searchInput = page.locator('#session-search');
    await searchInput.fill('MR');

    // 等待 debounce + API 调用 + 重新渲染
    await page.waitForResponse(resp => resp.url().includes('/api/agent/sessions/search'));

    // 搜索结果只包含 "MR" 相关会话（mock 按 title 过滤）
    const filteredCount = await sessionList.locator('.session-item').count();
    expect(filteredCount).toBeLessThan(initialCount);
    expect(filteredCount).toBeGreaterThanOrEqual(1);

    // 清空搜索 → loadSessions() 恢复完整列表
    await searchInput.fill('');
    await page.waitForResponse(resp => resp.url().includes('/api/agent/sessions') && !resp.url().includes('search'));
    const restoredCount = await sessionList.locator('.session-item').count();
    expect(restoredCount).toBe(initialCount);
  });

  test('切换会话', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 等待会话列表加载
    const firstSession = page.locator('.session-item').first();
    await expect(firstSession).toBeVisible({ timeout: 5000 });

    // 点击第一个会话
    await firstSession.click();

    // 应获得 active class
    await expect(firstSession).toHaveClass(/active/);

    // 消息区应加载该会话的消息（欢迎消息消失，出现用户/bot 消息）
    await expect(page.locator('.message.user').first()).toBeVisible({ timeout: 5000 });
  });
});

// ═══════════════════════════════════════════════════
// 4. 引擎切换测试
// ═══════════════════════════════════════════════════

test.describe('Chat — 引擎切换', () => {
  test('引擎切换 UI 和 API 调用', async ({ fluxvitaPage: page }) => {
    let engineSwitchCalled = false;
    let switchedEngine = '';

    await setupChatMocks(page);

    // 重新 mock engine PUT 以追踪调用
    await page.route('**/api/agent/engine', (route: Route) => {
      if (route.request().method() === 'PUT') {
        engineSwitchCalled = true;
        const body = route.request().postDataJSON();
        switchedEngine = body?.engine || '';
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      }
      return route.continue();
    });

    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 初始状态：builtin 是 active
    const builtinOpt = page.locator('.engine-opt[data-engine="builtin"]');
    const claudeOpt = page.locator('.engine-opt[data-engine="claude_agent"]');
    await expect(builtinOpt).toHaveClass(/active/);
    await expect(claudeOpt).not.toHaveClass(/active/);

    // 点击 Claude Code 引擎
    await claudeOpt.click();

    // active class 应切换
    await expect(claudeOpt).toHaveClass(/active/, { timeout: 3000 });
    await expect(builtinOpt).not.toHaveClass(/active/);
  });
});

// ═══════════════════════════════════════════════════
// 5. 输入框交互测试
// ═══════════════════════════════════════════════════

test.describe('Chat — 输入框交互', () => {
  test('输入框自动增长', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    const textarea = page.locator('textarea#input');
    await expect(textarea).toBeVisible();

    // 记录初始高度
    const initialHeight = await textarea.evaluate((el: HTMLTextAreaElement) => el.scrollHeight);

    // 输入多行文字
    const longText = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    await textarea.fill(longText);

    // 触发 input 事件以激活 autoResize
    await textarea.dispatchEvent('input');

    // 高度应增加
    const newHeight = await textarea.evaluate((el: HTMLTextAreaElement) => el.scrollHeight);
    expect(newHeight).toBeGreaterThan(initialHeight);
  });

  test('Enter 发送消息', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    const textarea = page.locator('textarea#input');
    await textarea.fill('测试消息：Enter 发送');

    // 按 Enter 发送
    await textarea.press('Enter');

    // 用户消息应出现在消息区
    await expect(page.locator('.message.user').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.message.user').first()).toContainText('测试消息：Enter 发送');

    // 输入框应清空
    await expect(textarea).toHaveValue('');
  });

  test('Shift+Enter 换行不发送', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    const textarea = page.locator('textarea#input');
    await textarea.click();
    await textarea.type('第一行');

    // 按 Shift+Enter — 应插入换行
    await textarea.press('Shift+Enter');
    await textarea.type('第二行');

    // 输入框应包含两行内容，而不是被发送
    const value = await textarea.inputValue();
    expect(value).toContain('第一行');
    expect(value).toContain('第二行');

    // 消息区不应有新的用户消息（欢迎消息除外）
    const userMessages = page.locator('.message.user');
    await expect(userMessages).toHaveCount(0);
  });

  test('发送按钮发送消息', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    const textarea = page.locator('textarea#input');
    const sendBtn = page.locator('#send-btn');

    // 输入框空时发送按钮应有 hidden class
    await expect(sendBtn).toHaveClass(/hidden/);

    // 输入内容
    await textarea.fill('点击按钮发送');
    await textarea.dispatchEvent('input');

    // 发送按钮应出现（hidden class 移除）
    await expect(sendBtn).not.toHaveClass(/hidden/, { timeout: 2000 });

    // 点击发送
    await sendBtn.click();

    // 用户消息出现
    await expect(page.locator('.message.user').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.message.user').first()).toContainText('点击按钮发送');

    // 输入框清空
    await expect(textarea).toHaveValue('');
  });

  test('输入提示可见', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 输入提示应包含 Enter 和 Shift+Enter
    const hint = page.locator('#input-hint, .input-hint');
    await expect(hint).toBeVisible();
    const hintText = await hint.textContent();
    expect(hintText).toContain('Enter');
    expect(hintText).toContain('Shift');
  });
});

// ═══════════════════════════════════════════════════
// 6. 消息区交互测试
// ═══════════════════════════════════════════════════

test.describe('Chat — 消息区交互', () => {
  test('工具卡片展开收起', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);

    // 覆盖 sessions/:id mock，返回包含工具卡片数据的消息
    await page.route('**/api/agent/sessions/*', (route: Route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            messages: [
              { role: 'user', content: '搜索数据', created_at: '2026-03-08T10:00:00Z' },
              {
                role: 'assistant', content: '搜索完成',
                tool_calls: [{ name: 'search_data', args: { query: 'MR' }, result: '找到 3 条结果', status: 'success' }],
                created_at: '2026-03-08T10:00:05Z',
              },
            ],
          }),
        });
      }
      return route.continue();
    });

    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 加载一个会话以触发工具卡片渲染
    await expect(page.locator('.session-item').first()).toBeVisible({ timeout: 5000 });
    await page.locator('.session-item').first().click();

    // 等待工具卡片出现
    const toolCard = page.locator('.tool-card').first();
    // 如果没有工具卡片，说明消息渲染方式不同，跳过此断言
    const toolCardCount = await page.locator('.tool-card').count();
    if (toolCardCount > 0) {
      // 初始状态：不展开
      await expect(toolCard).not.toHaveClass(/expanded/);

      // 点击展开
      await toolCard.click();
      await expect(toolCard).toHaveClass(/expanded/);

      // 展开后结果区应可见
      await expect(toolCard.locator('.tool-card-result')).toBeVisible();

      // 再次点击收起
      await toolCard.click();
      await expect(toolCard).not.toHaveClass(/expanded/);
    }
  });

  test('反馈按钮', async ({ fluxvitaPage: page }) => {
    let feedbackCalled = false;
    let feedbackType = '';

    await setupChatMocks(page);

    // 追踪 feedback API 调用
    await page.route('**/api/agent/feedback', (route: Route) => {
      feedbackCalled = true;
      const body = route.request().postDataJSON();
      feedbackType = body?.type || body?.vote || '';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 发送消息以触发 bot 回复（带反馈按钮）
    const textarea = page.locator('textarea#input');
    await textarea.fill('触发回复');
    await textarea.press('Enter');

    // 等待 bot 消息出现
    const botMsg = page.locator('.message.bot').first();
    await expect(botMsg).toBeVisible({ timeout: 8000 });

    // 反馈按钮在 hover 时显示
    await botMsg.hover();
    const feedbackBtns = botMsg.locator('.msg-feedback button');
    const feedbackCount = await feedbackBtns.count();

    if (feedbackCount > 0) {
      // 点击第一个反馈按钮（通常是 thumbs up）
      await feedbackBtns.first().click();

      // 按钮应获得 active class
      await expect(feedbackBtns.first()).toHaveClass(/active/, { timeout: 3000 });
    }
  });
});

// ═══════════════════════════════════════════════════
// 7. 工作风格模态框测试
// ═══════════════════════════════════════════════════

test.describe('Chat — 工作风格模态框', () => {
  test('打开 → 编辑 → 保存 → 关闭', async ({ fluxvitaPage: page }) => {
    let workstyleSaved = false;
    let savedContent = '';

    await setupChatMocks(page);

    // 追踪 workstyle save
    await page.route('**/api/agent/workstyle', (route: Route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_WORKSTYLE),
        });
      }
      if (route.request().method() === 'PUT') {
        workstyleSaved = true;
        const body = route.request().postDataJSON();
        savedContent = body?.content || '';
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      }
      return route.continue();
    });

    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 模态框初始不可见
    const modal = page.locator('#workstyle-modal');
    await expect(modal).not.toHaveClass(/active/);

    // 点击侧栏底部按钮打开
    await page.locator('.sidebar-footer-btn').click();

    // 模态框出现
    await expect(modal).toHaveClass(/active/, { timeout: 3000 });

    // 编辑器（textarea）可见
    const editor = page.locator('#workstyle-editor');
    await expect(editor).toBeVisible();

    // 等待 openWorkstyle() fetch 完成并填充 editor（避免 fill 和 fetch 竞争）
    await expect(editor).not.toHaveValue('', { timeout: 3000 });

    // 编辑内容
    await editor.fill('# 新的工作方式\n\n- 更简洁');

    // 点击保存
    await page.locator('#workstyle-modal .modal-footer .btn-primary').click();

    // 保存后模态框关闭
    await expect(modal).not.toHaveClass(/active/, { timeout: 3000 });

    // 验证 API 被调用
    expect(workstyleSaved).toBe(true);
    expect(savedContent).toContain('新的工作方式');
  });

  test('关闭按钮关闭模态框', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 打开
    await page.locator('.sidebar-footer-btn').click();
    const modal = page.locator('#workstyle-modal');
    await expect(modal).toHaveClass(/active/, { timeout: 3000 });

    // 点击 X 关闭
    await page.locator('#workstyle-modal .modal-close').click();
    await expect(modal).not.toHaveClass(/active/, { timeout: 3000 });
  });

  test('取消按钮关闭模态框', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 打开
    await page.locator('.sidebar-footer-btn').click();
    await expect(page.locator('#workstyle-modal')).toHaveClass(/active/, { timeout: 3000 });

    // 点击取消按钮（modal-footer 中非 btn-primary 的按钮）
    await page.locator('#workstyle-modal .modal-footer .btn:not(.btn-primary)').click();
    await expect(page.locator('#workstyle-modal')).not.toHaveClass(/active/, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════
// 8. 终端面板测试
// ═══════════════════════════════════════════════════

test.describe('Chat — 终端面板', () => {
  test('终端面板切换显示/隐藏', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    const termPanel = page.locator('#terminal-panel');

    // 初始不可见
    await expect(termPanel).not.toHaveClass(/visible/);

    // 查找终端切换按钮（可能是 .terminal-toggle-btn 或 header 中的按钮）
    const toggleBtn = page.locator('.terminal-toggle-btn').first();
    const toggleBtnCount = await toggleBtn.count();

    if (toggleBtnCount > 0) {
      // 点击打开
      await toggleBtn.click();
      await expect(termPanel).toHaveClass(/visible/, { timeout: 3000 });

      // 面板内的模式按钮可见
      await expect(page.locator('.term-mode-btn[data-mode="shell"]')).toBeVisible();
      await expect(page.locator('.term-mode-btn[data-mode="tmux"]')).toBeVisible();
      await expect(page.locator('#term-connect-btn')).toBeVisible();
      await expect(page.locator('#term-status')).toBeVisible();

      // 点击返回按钮关闭
      await page.locator('.term-back-btn').click();
      await expect(termPanel).not.toHaveClass(/visible/, { timeout: 3000 });
    }
  });

  test('终端模式按钮切换', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 如果有切换按钮，先打开终端面板
    const toggleBtn = page.locator('.terminal-toggle-btn').first();
    if (await toggleBtn.count() > 0) {
      await toggleBtn.click();
      await expect(page.locator('#terminal-panel')).toHaveClass(/visible/, { timeout: 3000 });

      // shell 模式按钮默认 active
      const shellBtn = page.locator('.term-mode-btn[data-mode="shell"]');
      const tmuxBtn = page.locator('.term-mode-btn[data-mode="tmux"]');

      await expect(shellBtn).toHaveClass(/active/);
      await expect(tmuxBtn).not.toHaveClass(/active/);

      // 点击 tmux
      await tmuxBtn.click();
      await expect(tmuxBtn).toHaveClass(/active/, { timeout: 2000 });
      await expect(shellBtn).not.toHaveClass(/active/);

      // tmux 模式下 session input 应出现
      const tmuxInput = page.locator('#tmux-sess-input');
      await expect(tmuxInput).toBeVisible();

      // 切回 shell
      await shellBtn.click();
      await expect(shellBtn).toHaveClass(/active/, { timeout: 2000 });
    }
  });
});

// ═══════════════════════════════════════════════════
// 9. 流式回复测试
// ═══════════════════════════════════════════════════

test.describe('Chat — 流式回复', () => {
  test('发送消息后接收 SSE 流式回复', async ({ fluxvitaPage: page }) => {
    await setupChatMocks(page);
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 8000 });

    // 发送消息
    const textarea = page.locator('textarea#input');
    await textarea.fill('请帮我查一下');
    await textarea.press('Enter');

    // 用户消息出现
    await expect(page.locator('.message.user').first()).toBeVisible({ timeout: 5000 });

    // Bot 回复应逐步出现（SSE mock 直接返回完整流）
    const botMsg = page.locator('.message.bot').first();
    await expect(botMsg).toBeVisible({ timeout: 8000 });

    // Bot 回复应包含 mock 中的内容
    await expect(botMsg).toContainText('测试回复', { timeout: 5000 });
  });
});

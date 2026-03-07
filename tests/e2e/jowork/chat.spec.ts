import { test, expect } from '../fixtures/auth';

/**
 * Jowork Chat 对话流程 E2E 测试
 *
 * 已注入 token（通过 joworkPage fixture），直接验证聊天界面功能。
 * 断言方式：DOM 状态 + SSE 响应 + 会话管理
 */
test.describe('Jowork Chat @smoke', () => {
  test('登录后显示聊天界面', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');

    // 登录态已注入，应直接进入 chat screen
    const chatScreen = page.locator('#chat-screen');
    await expect(chatScreen).toBeVisible({ timeout: 5000 });

    // login screen 应隐藏
    const loginScreen = page.locator('#login-screen');
    await expect(loginScreen).toBeHidden();
  });

  test('欢迎消息可见', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // 新会话应显示 welcome 消息
    const welcome = page.locator('.message.welcome');
    await expect(welcome).toBeVisible({ timeout: 5000 });
  });

  test('发送消息并等待响应', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // 输入消息（Jowork chat 的输入框是 textarea#input）
    const input = page.locator('textarea#input');
    await input.fill('你好，这是 E2E 测试消息，请简短回复');
    await expect(input).toHaveValue(/E2E/);

    // 发送（点击 send 按钮或按 Enter）
    await page.locator('#send-btn').click();

    // 等待 user message 出现
    const userMsg = page.locator('.message.user').last();
    await expect(userMsg).toBeVisible({ timeout: 5000 });
    await expect(userMsg).toContainText('E2E');

    // 等待 bot response 或 error（本地无 AI 模型时可能报错）
    const botOrError = page.locator('.message.bot, .message.error').last();
    await expect(botOrError).toBeVisible({ timeout: 30000 });
  });

  test('新建对话按钮有效', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // 新建对话
    await page.locator('.new-chat-btn').click();

    // welcome 消息应重新出现
    const welcome = page.locator('.message.welcome');
    await expect(welcome).toBeVisible({ timeout: 5000 });
  });

  test('会话列表可见', async ({ joworkPage: page }) => {
    await page.goto('/chat.html');
    await expect(page.locator('#chat-screen')).toBeVisible({ timeout: 5000 });

    // sidebar 应包含会话列表区域
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();
  });
});

test.describe('Jowork Chat 未登录态', () => {
  test('未登录时显示 login screen', async ({ page }) => {
    // 清除 token
    await page.addInitScript(() => {
      localStorage.clear();
    });
    await page.goto('/chat.html');

    const loginScreen = page.locator('#login-screen');
    await expect(loginScreen).toBeVisible({ timeout: 5000 });
  });
});

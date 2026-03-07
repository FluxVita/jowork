import { test, expect } from '../fixtures/auth';

/**
 * FluxVita Chat 对话测试
 *
 * FluxVita 企业版的 chat.html，认证 token key 是 fluxvita_token。
 */
test.describe('FluxVita Chat @smoke', () => {
  test('登录后显示聊天界面', async ({ fluxvitaPage: page }) => {
    await page.goto('/chat.html');

    // 主聊天区域可见
    const chatArea = page.locator('#chat-screen, #messages, .chat-layout').first();
    await expect(chatArea).toBeVisible({ timeout: 8000 });
  });

  test('欢迎消息可见', async ({ fluxvitaPage: page }) => {
    await page.goto('/chat.html');

    const welcome = page.locator('.message.welcome, .welcome-msg, [class*="welcome"]').first();
    await expect(welcome).toBeVisible({ timeout: 8000 });
  });
});

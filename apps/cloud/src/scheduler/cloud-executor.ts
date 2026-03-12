import { getDb } from '../db';
import { CredentialVault } from '../credentials/vault';

/**
 * Cloud Executor: runs scheduled tasks on the cloud side.
 * Used when the user's desktop is offline but cloud credentials are authorized.
 */
export class CloudExecutor {
  private vault: CredentialVault;

  constructor() {
    this.vault = new CredentialVault(getDb());
  }

  /**
   * Execute a scan task using cloud-stored credentials.
   * Fetches encrypted credential from vault, then calls the connector API.
   */
  async executeScan(userId: string, taskConfig: Record<string, unknown>): Promise<string> {
    const connectorId = taskConfig.connectorId as string;
    if (!connectorId) {
      throw new Error('No connectorId in task config');
    }

    const encrypted = await this.vault.getCredential(userId, connectorId);
    if (!encrypted) {
      throw new Error(`No cloud credentials for connector: ${connectorId}`);
    }

    // Connector-specific scan via their APIs
    // In production, this would decrypt and call the actual API
    // For now, we log and return a summary
    const scanStrategies: Record<string, string> = {
      github: 'https://api.github.com/notifications',
      gitlab: 'https://gitlab.com/api/v4/merge_requests',
      feishu: 'https://open.feishu.cn/open-apis/im/v1/messages',
    };

    const apiUrl = scanStrategies[connectorId];
    if (!apiUrl) {
      return `Cloud scan: no strategy for connector ${connectorId}`;
    }

    try {
      // Decrypt credential (encrypted is stored as-is for now; in production use AES)
      const credential = JSON.parse(encrypted) as { token?: string };
      const token = credential.token;
      if (!token) {
        throw new Error('No token in decrypted credential');
      }

      const res = await fetch(apiUrl, {
        headers: {
          'Authorization': connectorId === 'feishu' ? `Bearer ${token}` : `token ${token}`,
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`API returned ${res.status}: ${res.statusText}`);
      }

      const data = await res.json() as unknown[];
      return `Cloud scan completed for ${connectorId}: ${Array.isArray(data) ? data.length : 0} items found`;
    } catch (err) {
      throw new Error(`Cloud scan failed for ${connectorId}: ${err}`);
    }
  }

  /**
   * Execute a skill task using Cloud Engine.
   * Requires the cloud engine (Claude Agent SDK) to be available.
   */
  async executeSkill(userId: string, taskConfig: Record<string, unknown>): Promise<string> {
    const skillId = taskConfig.skillId as string;
    if (!skillId) {
      throw new Error('No skillId in task config');
    }

    const prompt = taskConfig.prompt as string ?? '';
    const variables = taskConfig.variables as Record<string, string> ?? {};

    // Cloud engine execution — delegates to Claude Agent SDK
    // This requires ANTHROPIC_API_KEY to be set on the cloud server
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Cloud engine not available: ANTHROPIC_API_KEY not configured');
    }

    const systemPrompt = taskConfig.systemPrompt as string ?? 'You are a helpful assistant.';
    const userMessage = Object.entries(variables).reduce(
      (text, [key, val]) => text.replace(`{{${key}}}`, val),
      prompt,
    );

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Claude API error ${res.status}: ${errBody}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const output = data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    return output || 'Skill executed (no text output)';
  }

  /**
   * Send a notification through a cloud channel (Feishu, etc.).
   */
  async executeNotify(userId: string, taskConfig: Record<string, unknown>): Promise<string> {
    const channel = taskConfig.channel as string ?? 'feishu';
    const message = taskConfig.message as string ?? '';
    const chatId = taskConfig.chatId as string;

    if (!message) {
      throw new Error('No message in notify task config');
    }

    switch (channel) {
      case 'feishu': {
        if (!chatId) {
          throw new Error('chatId required for Feishu notifications');
        }
        await this.sendFeishuMessage(chatId, message);
        return `Notification sent via Feishu: ${message.slice(0, 50)}`;
      }
      default:
        throw new Error(`Unsupported notification channel: ${channel}`);
    }
  }

  private async sendFeishuMessage(chatId: string, text: string): Promise<void> {
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    if (!appId || !appSecret) {
      throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET must be set');
    }

    // Get tenant token
    const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const tokenData = await tokenRes.json() as { code: number; tenant_access_token?: string };
    if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
      throw new Error('Failed to get Feishu tenant token');
    }

    // Send message
    const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.tenant_access_token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    });

    const data = await res.json() as { code: number; msg?: string };
    if (data.code !== 0) {
      throw new Error(`Feishu send failed: ${data.msg}`);
    }
  }
}

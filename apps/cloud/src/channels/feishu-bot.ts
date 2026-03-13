import type { Context } from 'hono';
import { routeTask, type RouteDecision } from './router';
import { connections } from './connections';
import { taskQueue } from './task-queue';
import { CloudExecutor } from '../scheduler/cloud-executor';

interface FeishuEvent {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    token: string;
  };
  event: {
    sender: { sender_id: { open_id: string } };
    message: {
      message_id: string;
      message_type: string;
      content: string;
      chat_id: string;
    };
  };
}

// Map Feishu open_id to JoWork userId (simple mapping; in production use DB lookup)
const FEISHU_USER_MAP: Record<string, string> = {};

function resolveUserId(openId: string): string | null {
  return FEISHU_USER_MAP[openId] ?? null;
}

/**
 * Feishu Bot webhook handler.
 * Receives messages from Feishu, routes them, and sends replies.
 */
export async function handleFeishuWebhook(c: Context): Promise<Response> {
  const body = await c.req.json();

  // URL verification challenge
  if (body.type === 'url_verification') {
    return c.json({ challenge: body.challenge });
  }

  const event = body as FeishuEvent;
  if (event.header?.event_type !== 'im.message.receive_v1') {
    return c.json({ ok: true });
  }

  const message = event.event.message;
  const senderId = event.event.sender.sender_id.open_id;

  // Parse message content
  let text = '';
  try {
    const content = JSON.parse(message.content);
    text = content.text ?? '';
  } catch {
    text = message.content;
  }

  if (!text.trim()) {
    return c.json({ ok: true });
  }

  // Resolve JoWork user from Feishu sender
  const userId = resolveUserId(senderId);
  const userOnline = userId ? connections.isOnline(userId) : false;

  // Route decision
  const decision: RouteDecision = routeTask({
    action: inferAction(text),
    requiresLocalAccess: needsLocalAccess(text),
    userOnline,
  });

  // Handle based on routing decision
  switch (decision) {
    case 'cloud': {
      // Execute via cloud engine
      await replyToFeishu(senderId, message.chat_id, 'Processing your request...');
      try {
        const executor = new CloudExecutor();
        const result = await executor.executeSkill(userId ?? 'anonymous', {
          skillId: 'feishu-chat',
          prompt: text,
          systemPrompt: 'You are JoWork, a helpful AI assistant responding via Feishu. Be concise.',
        });
        await replyToFeishu(senderId, message.chat_id, result);
      } catch (err) {
        await replyToFeishu(senderId, message.chat_id, `Error: ${String(err)}`);
      }
      break;
    }
    case 'local': {
      // Forward to connected desktop via WebSocket
      if (userId) {
        const forwarded = connections.forward(userId, {
          type: 'feishu_message',
          payload: { text, chatId: message.chat_id, senderId },
        });
        if (forwarded) {
          await replyToFeishu(senderId, message.chat_id, 'Forwarded to your local JoWork.');
        } else {
          await replyToFeishu(senderId, message.chat_id, 'Your desktop appears offline. Task queued.');
        }
      } else {
        await replyToFeishu(senderId, message.chat_id, 'User not linked. Please link your Feishu account in JoWork settings.');
      }
      break;
    }
    case 'queue': {
      // Enqueue task for later execution when desktop comes back online
      if (userId) {
        taskQueue.enqueue(userId, {
          userId,
          type: 'feishu_message',
          payload: { text, chatId: message.chat_id, senderId },
          source: 'feishu',
        });
        const count = taskQueue.count(userId);
        await replyToFeishu(senderId, message.chat_id,
          `Your computer is offline. Task queued (${count} pending) — will execute when you come back online.`);
      } else {
        await replyToFeishu(senderId, message.chat_id, 'User not linked. Please link your Feishu account in JoWork settings.');
      }
      break;
    }
  }

  return c.json({ ok: true });
}

function inferAction(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('open file') || lower.includes('打开文件')) return 'open_file';
  if (lower.includes('run') || lower.includes('执行')) return 'run_command';
  if (lower.includes('clipboard') || lower.includes('剪贴板')) return 'read_clipboard';
  return 'chat';
}

function needsLocalAccess(text: string): boolean {
  const localKeywords = ['本地', 'local', '文件', 'file', '终端', 'terminal', '命令', 'command'];
  return localKeywords.some((kw) => text.toLowerCase().includes(kw));
}

async function getFeishuTenantToken(): Promise<string> {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET must be set');
  }

  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  const data = await res.json() as { code: number; tenant_access_token?: string; msg?: string };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Failed to get tenant token: ${data.msg ?? 'unknown error'}`);
  }
  return data.tenant_access_token;
}

async function replyToFeishu(_userId: string, chatId: string, text: string): Promise<void> {
  try {
    const token = await getFeishuTenantToken();

    const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    });

    const data = await res.json() as { code: number; msg?: string };
    if (data.code !== 0) {
      console.error(`[FeishuBot] Send failed: ${data.msg}`);
    }
  } catch (err) {
    console.error('[FeishuBot] Reply error:', err);
  }
}

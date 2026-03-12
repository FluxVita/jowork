import type { Context } from 'hono';
import { routeTask, type RouteDecision } from './router';

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

  // Route decision
  const decision: RouteDecision = routeTask({
    action: inferAction(text),
    requiresLocalAccess: needsLocalAccess(text),
    userOnline: false, // TODO: check WebSocket connection status
  });

  // Queue response based on routing
  switch (decision) {
    case 'cloud':
      // TODO: execute via cloud engine and reply
      await replyToFeishu(senderId, message.chat_id, 'Processing your request...');
      break;
    case 'local':
      // TODO: forward via WebSocket
      await replyToFeishu(senderId, message.chat_id, 'Forwarding to your local JoWork...');
      break;
    case 'queue':
      await replyToFeishu(senderId, message.chat_id, 'Your computer is offline. Task queued — will execute when you come back online.');
      break;
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

async function replyToFeishu(_userId: string, _chatId: string, _text: string): Promise<void> {
  // TODO: implement actual Feishu message send API
  // POST https://open.feishu.cn/open-apis/im/v1/messages
  console.log(`[FeishuBot] Would reply: ${_text}`);
}

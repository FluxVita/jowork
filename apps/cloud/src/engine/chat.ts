import type { Context } from 'hono';
import { stream } from 'hono/streaming';
import { getDb } from '../db';
import { cloudSessions, cloudMessages } from '../db/schema';
import { consumeCredits } from '../billing/credits';
import { resolveProvider } from './provider';
import { eq } from 'drizzle-orm';

/**
 * POST /engine/chat — Cloud AI chat endpoint.
 * Accepts a message and streams SSE responses.
 * Supports Moonshot, OpenAI, Anthropic (auto-detected from env).
 *
 * Body: { message: string, sessionId?: string, systemContext?: string }
 * Response: SSE stream of engine events
 */
export async function handleChat(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;

  const body = await c.req.json<{
    message: string;
    sessionId?: string;
    systemContext?: string;
  }>();

  if (!body.message?.trim()) {
    return c.json({ error: 'Message is required' }, 400);
  }

  // Check credits before proceeding
  const credit = await consumeCredits(userId, 'chat');
  if (!credit.success) {
    return c.json({ error: 'Insufficient credits', remaining: credit.remaining }, 402);
  }

  const provider = resolveProvider();
  if (!provider) {
    return c.json({ error: 'Cloud AI not configured' }, 503);
  }

  const systemPrompt = body.systemContext || 'You are JoWork, a helpful AI work assistant.';

  // Create or get session
  const db = getDb();
  let sessionId = body.sessionId;

  if (!sessionId) {
    sessionId = `cses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(cloudSessions).values({
      id: sessionId,
      userId,
      title: body.message.slice(0, 50),
      engineId: 'jowork-cloud',
      messageCount: 0,
    });
  }

  // Save user message
  const userMsgId = `cmsg_${Date.now()}_u`;
  await db.insert(cloudMessages).values({
    id: userMsgId,
    sessionId,
    role: 'user',
    content: body.message,
  });

  // Build message history for context
  const history = await db.select().from(cloudMessages)
    .where(eq(cloudMessages.sessionId, sessionId))
    .orderBy(cloudMessages.createdAt);

  const chatMessages = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // Stream response
  return stream(c, async (writable) => {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    try {
      // Emit session info (v2 format)
      await writable.write(`event: system\ndata: ${JSON.stringify({ type: 'system', sessionId, provider: provider.name, model: provider.model })}\n\n`);

      let assistantContent = '';

      if (provider.format === 'openai') {
        assistantContent = await streamOpenAIv2(writable, provider, chatMessages, systemPrompt);
      } else {
        assistantContent = await streamAnthropicV2(writable, provider, chatMessages, systemPrompt);
      }

      // Save assistant message
      if (assistantContent) {
        const assistMsgId = `cmsg_${Date.now()}_a`;
        await db.insert(cloudMessages).values({
          id: assistMsgId,
          sessionId: sessionId!,
          role: 'assistant',
          content: assistantContent,
        });
        await db.update(cloudSessions).set({
          messageCount: history.length + 2,
          updatedAt: new Date(),
        }).where(eq(cloudSessions.id, sessionId!));
      }

      await writable.write(`event: done\ndata: ${JSON.stringify({ type: 'done' })}\n\n`);
    } catch (err) {
      await writable.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
      await writable.write(`event: done\ndata: ${JSON.stringify({ type: 'done' })}\n\n`);
    }
  });
}

async function streamOpenAIv2(
  writable: { write: (data: string) => Promise<unknown> },
  provider: NonNullable<ReturnType<typeof resolveProvider>>,
  messages: { role: string; content: string }[],
  systemPrompt: string,
): Promise<string> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 4096,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    await writable.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: `${provider.name}: ${response.status} ${errText}` })}\n\n`);
    return '';
  }

  const reader = response.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          content += delta;
          await writable.write(`event: text\ndata: ${JSON.stringify({ type: 'text', content: delta })}\n\n`);
        }
      } catch { /* skip */ }
    }
  }

  return content;
}

async function streamAnthropicV2(
  writable: { write: (data: string) => Promise<unknown> },
  provider: NonNullable<ReturnType<typeof resolveProvider>>,
  messages: { role: string; content: string }[],
  systemPrompt: string,
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    await writable.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: `Anthropic: ${response.status} ${errText}` })}\n\n`);
    return '';
  }

  const reader = response.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          content += event.delta.text;
          await writable.write(`event: text\ndata: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`);
        } else if (event.type === 'message_delta' && event.usage) {
          await writable.write(`event: usage\ndata: ${JSON.stringify({ type: 'usage', ...event.usage })}\n\n`);
        }
      } catch { /* skip */ }
    }
  }

  return content;
}

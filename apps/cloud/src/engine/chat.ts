import type { Context } from 'hono';
import { stream } from 'hono/streaming';
import { getDb } from '../db';
import { cloudSessions, cloudMessages } from '../db/schema';
import { consumeCredits } from '../billing/credits';
import { eq } from 'drizzle-orm';

/**
 * POST /engine/chat — Cloud AI chat endpoint.
 * Accepts a message and streams SSE responses.
 * Uses Anthropic Claude API server-side.
 *
 * Body: { message: string, sessionId?: string, systemContext?: string }
 * Response: SSE stream of engine events
 */
export async function handleChat(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const plan = c.get('userPlan') as string || 'free';

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

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return c.json({ error: 'Cloud AI not configured' }, 503);
  }

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

  const anthropicMessages = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // Stream response from Anthropic API
  return stream(c, async (writable) => {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env['ANTHROPIC_MODEL'] || 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: body.systemContext || 'You are JoWork, a helpful AI work assistant.',
          messages: anthropicMessages,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        await writable.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: `Anthropic API: ${response.status} ${errText}` })}\n\n`);
        await writable.write(`event: done\ndata: ${JSON.stringify({ type: 'done' })}\n\n`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        await writable.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: 'No response stream' })}\n\n`);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              if (event.type === 'content_block_delta' && event.delta?.text) {
                assistantContent += event.delta.text;
                await writable.write(`event: text\ndata: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`);
              } else if (event.type === 'message_start') {
                await writable.write(`event: system\ndata: ${JSON.stringify({ type: 'system', sessionId })}\n\n`);
              } else if (event.type === 'message_stop') {
                // Save assistant message
                if (assistantContent) {
                  const assistMsgId = `cmsg_${Date.now()}_a`;
                  await db.insert(cloudMessages).values({
                    id: assistMsgId,
                    sessionId,
                    role: 'assistant',
                    content: assistantContent,
                    tokens: event.usage?.output_tokens,
                  });
                  // Update session message count
                  await db.update(cloudSessions).set({
                    messageCount: history.length + 2, // +user +assistant
                    updatedAt: new Date(),
                  }).where(eq(cloudSessions.id, sessionId!));
                }
              } else if (event.type === 'message_delta' && event.usage) {
                await writable.write(`event: usage\ndata: ${JSON.stringify({ type: 'usage', ...event.usage })}\n\n`);
              }
            } catch {
              // Skip non-JSON lines
            }
          }
        }
      }

      await writable.write(`event: done\ndata: ${JSON.stringify({ type: 'done' })}\n\n`);
    } catch (err) {
      await writable.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
      await writable.write(`event: done\ndata: ${JSON.stringify({ type: 'done' })}\n\n`);
    }
  });
}

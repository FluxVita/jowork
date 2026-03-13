/**
 * V1-compatible agent routes.
 * Maps old /api/agent/* endpoints to v2 cloud backend.
 * The v1 frontend (shell.html/chat.html) calls these routes.
 */
import type { Context } from 'hono';
import { stream } from 'hono/streaming';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db';
import { cloudSessions, cloudMessages, userPreferences } from '../db/schema';
import { consumeCredits } from '../billing/credits';
import { resolveProvider } from '../engine/provider';

const SYSTEM_PROMPT = `You are JoWork, an AI work assistant that helps users be more productive.

Key traits:
- Concise and direct — lead with the answer, not the reasoning
- Helpful for work tasks: writing, analysis, coding, planning, brainstorming
- When asked to write, match the appropriate tone (professional for emails, casual for messages)
- Support both English and Chinese — respond in whatever language the user writes in
- If you don't know something, say so honestly rather than guessing`;

// Rough char→token ratio (~4 chars per token). Keep context under model limit.
const MAX_CONTEXT_CHARS = 24000; // ~6k tokens, safe for 8k context models

/** Trim oldest messages to fit within token budget, always keeping the last user message. */
function trimHistory(messages: { role: string; content: string }[]): { role: string; content: string }[] {
  let totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const trimmed = [...messages];

  // Drop oldest messages (but never the last one) until within budget
  while (totalChars > MAX_CONTEXT_CHARS && trimmed.length > 1) {
    const removed = trimmed.shift()!;
    totalChars -= removed.content.length;
  }
  return trimmed;
}

/** Generate a short title for a session based on the first user message. */
async function generateSessionTitle(
  provider: NonNullable<ReturnType<typeof resolveProvider>>,
  userMessage: string,
): Promise<string> {
  const prompt = `Generate a very short title (max 6 words) for a conversation that starts with this message. Reply with ONLY the title, no quotes, no punctuation at the end. If the message is in Chinese, reply in Chinese.\n\nMessage: ${userMessage.slice(0, 200)}`;

  try {
    if (provider.format === 'openai') {
      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 30,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: { message?: { content?: string } }[] };
        const title = data.choices?.[0]?.message?.content?.trim();
        if (title && title.length > 0 && title.length <= 80) return title;
      }
    } else {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 30,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: { text?: string }[] };
        const title = data.content?.[0]?.text?.trim();
        if (title && title.length > 0 && title.length <= 80) return title;
      }
    }
  } catch {
    // Fallback to truncation
  }
  return userMessage.slice(0, 50);
}

// --- Engines ---

export function getEngines(c: Context): Response {
  return c.json({
    default: 'jowork-cloud',
    engines: [
      { id: 'jowork-cloud', name: 'JoWork Cloud', installed: true, description: 'Cloud AI powered by Claude' },
    ],
  });
}

export function setEngine(c: Context): Response {
  // No-op in cloud mode — only jowork-cloud available
  return c.json({ ok: true });
}

// --- Sessions ---

export async function listSessions(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const db = getDb();

  const sessions = await db.select().from(cloudSessions)
    .where(eq(cloudSessions.userId, userId))
    .orderBy(desc(cloudSessions.updatedAt));

  // V1 format: { sessions: [{ session_id, title, engine, message_count, created_at, updated_at }] }
  return c.json({
    sessions: sessions.map((s) => ({
      session_id: s.id,
      title: s.title || 'New Chat',
      engine: s.engineId || 'jowork-cloud',
      message_count: s.messageCount ?? 0,
      created_at: s.createdAt.toISOString(),
      updated_at: s.updatedAt.toISOString(),
    })),
  });
}

export async function getSession(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const sessionId = c.req.param('id')!;
  const db = getDb();

  const [session] = await db.select().from(cloudSessions)
    .where(eq(cloudSessions.id, sessionId));

  if (!session || session.userId !== userId) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const messages = await db.select().from(cloudMessages)
    .where(eq(cloudMessages.sessionId, sessionId))
    .orderBy(cloudMessages.createdAt);

  return c.json({
    session_id: session.id,
    title: session.title || 'New Chat',
    engine: session.engineId || 'jowork-cloud',
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.createdAt.toISOString(),
    })),
  });
}

export async function deleteSession(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const sessionId = c.req.param('id')!;
  const db = getDb();

  const [session] = await db.select().from(cloudSessions)
    .where(eq(cloudSessions.id, sessionId));

  if (!session || session.userId !== userId) {
    return c.json({ error: 'Session not found' }, 404);
  }

  await db.delete(cloudMessages).where(eq(cloudMessages.sessionId, sessionId));
  await db.delete(cloudSessions).where(eq(cloudSessions.id, sessionId));

  return c.json({ ok: true });
}

export async function clearSessions(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const db = getDb();

  const sessions = await db.select({ id: cloudSessions.id }).from(cloudSessions)
    .where(eq(cloudSessions.userId, userId));

  for (const s of sessions) {
    await db.delete(cloudMessages).where(eq(cloudMessages.sessionId, s.id));
  }
  await db.delete(cloudSessions).where(eq(cloudSessions.userId, userId));

  return c.json({ ok: true, cleared: sessions.length });
}

export async function searchSessions(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const q = c.req.query('q') || '';

  if (!q.trim()) {
    return c.json({ sessions: [] });
  }

  const db = getDb();

  const sessions = await db.select().from(cloudSessions)
    .where(eq(cloudSessions.userId, userId))
    .orderBy(desc(cloudSessions.updatedAt));

  // Simple title-based search (v1 compat)
  const filtered = sessions.filter((s) =>
    (s.title || '').toLowerCase().includes(q.toLowerCase()),
  );

  return c.json({
    sessions: filtered.map((s) => ({
      session_id: s.id,
      title: s.title || 'New Chat',
      engine: s.engineId || 'jowork-cloud',
      message_count: s.messageCount ?? 0,
      created_at: s.createdAt.toISOString(),
      updated_at: s.updatedAt.toISOString(),
    })),
  });
}

// --- Chat (SSE with v1 event format) ---

export async function agentChat(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;

  const body = await c.req.json<{
    message: string;
    session_id?: string;
    engine?: string;
    images?: string[];
  }>();

  if (!body.message?.trim()) {
    return c.json({ error: 'Message is required' }, 400);
  }

  // Credit check
  const credit = await consumeCredits(userId, 'chat');
  if (!credit.success) {
    return c.json({ error: 'Insufficient credits', remaining: credit.remaining }, 402);
  }

  const provider = resolveProvider();
  if (!provider) {
    return c.json({ error: 'Cloud AI not configured' }, 503);
  }

  const db = getDb();
  let sessionId = body.session_id;
  let isNewSession = false;

  if (!sessionId) {
    sessionId = `cses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(cloudSessions).values({
      id: sessionId,
      userId,
      title: body.message.slice(0, 50),
      engineId: 'jowork-cloud',
      messageCount: 0,
    });
    isNewSession = true;
  }

  // Save user message
  const userMsgId = `cmsg_${Date.now()}_u`;
  await db.insert(cloudMessages).values({
    id: userMsgId,
    sessionId,
    role: 'user',
    content: body.message,
  });

  // Build history
  const history = await db.select().from(cloudMessages)
    .where(eq(cloudMessages.sessionId, sessionId))
    .orderBy(cloudMessages.createdAt);

  const allMessages = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const chatMessages = trimHistory(allMessages);

  // Generate AI title for new sessions (fire-and-forget, don't block streaming)
  if (isNewSession) {
    generateSessionTitle(provider, body.message).then((title) => {
      db.update(cloudSessions).set({ title }).where(eq(cloudSessions.id, sessionId!)).catch(() => {});
    });
  }

  // Stream SSE with v1 event names
  return stream(c, async (writable) => {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    try {
      // V1 expects session_created event first
      if (isNewSession) {
        await writable.write(`event: session_created\ndata: ${JSON.stringify({ type: 'session_created', session_id: sessionId })}\n\n`);
      }

      await writable.write(`event: engine_info\ndata: ${JSON.stringify({ type: 'engine_info', engine: 'jowork-cloud', model: provider.model, provider: provider.name })}\n\n`);

      if (provider.format === 'openai') {
        await streamOpenAI(writable, provider, chatMessages, db, sessionId!, history.length);
      } else {
        await streamAnthropic(writable, provider, chatMessages, db, sessionId!, history.length);
      }

      await writable.write(`event: done\ndata: ${JSON.stringify({ type: 'done' })}\n\n`);
    } catch (err) {
      await writable.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`);
      await writable.write(`event: done\ndata: ${JSON.stringify({ type: 'done' })}\n\n`);
    }
  });
}

/** Stream from OpenAI-compatible API (Moonshot, OpenAI, DeepSeek, etc.) */
async function streamOpenAI(
  writable: { write: (data: string) => Promise<unknown> },
  provider: ReturnType<typeof resolveProvider> & {},
  messages: { role: string; content: string }[],
  db: ReturnType<typeof getDb>,
  sessionId: string,
  historyLen: number,
): Promise<void> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    await writable.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: `${provider.name} API error: ${response.status} ${errText}` })}\n\n`);
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
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          assistantContent += delta;
          await writable.write(`event: text\ndata: ${JSON.stringify({ type: 'text', content: delta })}\n\n`);
        }
      } catch {
        // skip
      }
    }
  }

  if (assistantContent) {
    const assistMsgId = `cmsg_${Date.now()}_a`;
    await db.insert(cloudMessages).values({
      id: assistMsgId, sessionId, role: 'assistant', content: assistantContent,
    });
    await db.update(cloudSessions).set({
      messageCount: historyLen + 2, updatedAt: new Date(),
    }).where(eq(cloudSessions.id, sessionId));
  }
}

/** Stream from Anthropic native API */
async function streamAnthropic(
  writable: { write: (data: string) => Promise<unknown> },
  provider: ReturnType<typeof resolveProvider> & {},
  messages: { role: string; content: string }[],
  db: ReturnType<typeof getDb>,
  sessionId: string,
  historyLen: number,
): Promise<void> {
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
      system: SYSTEM_PROMPT,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    await writable.write(`event: error\ndata: ${JSON.stringify({ type: 'error', message: `Anthropic API error: ${response.status} ${errText}` })}\n\n`);
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
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          assistantContent += event.delta.text;
          await writable.write(`event: text\ndata: ${JSON.stringify({ type: 'text', content: event.delta.text })}\n\n`);
        }
      } catch {
        // skip
      }
    }
  }

  if (assistantContent) {
    const assistMsgId = `cmsg_${Date.now()}_a`;
    await db.insert(cloudMessages).values({
      id: assistMsgId, sessionId, role: 'assistant', content: assistantContent,
    });
    await db.update(cloudSessions).set({
      messageCount: historyLen + 2, updatedAt: new Date(),
    }).where(eq(cloudSessions.id, sessionId));
  }
}

// --- Stop ---

export function agentStop(c: Context): Response {
  // Cloud mode: generation stops naturally; no persistent process to kill
  return c.json({ ok: true });
}

// --- Tasks (compat — returns empty) ---

export function listAgentTasks(c: Context): Response {
  return c.json({ tasks: [] });
}

// --- Preferences (DB-persisted, memory fallback for tests) ---

const prefsFallback = new Map<string, Record<string, unknown>>();
const hasDb = !!process.env['DATABASE_URL'];

export async function getPreferences(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;

  if (!hasDb) {
    return c.json(prefsFallback.get(userId) ?? {});
  }

  const db = getDb();
  const [row] = await db.select().from(userPreferences)
    .where(eq(userPreferences.userId, userId));

  return c.json(row?.data ?? {});
}

export async function setPreferences(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const body = await c.req.json<Record<string, unknown>>();

  if (!hasDb) {
    const current = prefsFallback.get(userId) ?? {};
    prefsFallback.set(userId, { ...current, ...body });
    return c.json({ ok: true });
  }

  const db = getDb();
  const [existing] = await db.select().from(userPreferences)
    .where(eq(userPreferences.userId, userId));

  const merged = { ...(existing?.data as Record<string, unknown> ?? {}), ...body };

  if (existing) {
    await db.update(userPreferences)
      .set({ data: merged, updatedAt: new Date() })
      .where(eq(userPreferences.userId, userId));
  } else {
    await db.insert(userPreferences).values({
      userId,
      data: merged,
    });
  }

  return c.json({ ok: true });
}

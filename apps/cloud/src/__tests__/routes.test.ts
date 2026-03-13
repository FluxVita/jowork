import { describe, it, expect, beforeAll } from 'vitest';
import { app } from '../server';
import { signJwt } from '../auth/jwt';

// Helper to make requests against the Hono app
function request(path: string, opts: RequestInit = {}) {
  return app.request(path, opts);
}

function authHeaders(overrides: Record<string, string> = {}): HeadersInit {
  const token = signJwt({
    sub: 'test_user_1',
    email: 'test@example.com',
    name: 'Test User',
    plan: 'pro',
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...overrides,
  };
}

describe('Health endpoint', () => {
  it('GET /health returns 200', async () => {
    const res = await request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('Auth routes (no auth required)', () => {
  it('GET /auth/google returns redirect or HTML', async () => {
    const res = await request('/auth/google');
    // The Google OAuth route redirects to Google or returns a URL
    expect([200, 302, 400]).toContain(res.status);
  });

  it('GET /api/auth/google returns redirect or HTML', async () => {
    const res = await request('/api/auth/google');
    expect([200, 302, 400]).toContain(res.status);
  });

  it('POST /auth/refresh without body returns error', async () => {
    const res = await request('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Should return some error for missing refresh token
    expect(res.status).toBeLessThan(500);
  });

  it('POST /api/auth/local creates a local token', async () => {
    const res = await request('/api/auth/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'localtester', display_name: 'Local Tester' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.name).toBe('Local Tester');
  });

  it('POST /api/auth/login accepts compat login payload', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feishu_open_id: 'ou_xxx', name: 'Compat User' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.name).toBe('Compat User');
  });

  it('GET /api/system/setup-status returns compat setup response', async () => {
    const res = await request('/api/system/setup-status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.done).toBe(true);
    expect(body.gateway_url).toBeTruthy();
  });
});

describe('Protected routes without auth', () => {
  it('POST /billing/checkout returns 401 without token', async () => {
    const res = await request('/billing/checkout', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('GET /billing/credits returns 401 without token', async () => {
    const res = await request('/billing/credits');
    expect(res.status).toBe(401);
  });

  it('GET /api/billing/credits returns 401 without token', async () => {
    const res = await request('/api/billing/credits');
    expect(res.status).toBe(401);
  });

  it('POST /teams returns 401 without token', async () => {
    const res = await request('/teams', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('GET /api/teams returns 401 without token', async () => {
    const res = await request('/api/teams');
    expect(res.status).toBe(401);
  });

  it('GET /credentials/status returns 401 without token', async () => {
    const res = await request('/credentials/status');
    expect(res.status).toBe(401);
  });
});

describe('Protected routes with valid auth', () => {
  const hasDb = !!process.env.DATABASE_URL;

  it('GET /billing/credits returns credits (requires DB)', async () => {
    const res = await request('/billing/credits', {
      headers: authHeaders(),
    });
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('totalAvailable');
  });

  it('POST /teams creates a team (requires DB)', async () => {
    const res = await request('/teams', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Test Team' }),
    });
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Test Team');
    expect(body.id).toMatch(/^team_/);
    expect(body.inviteCode).toBeTruthy();
  });

  it('GET /teams lists teams (requires DB)', async () => {
    const res = await request('/teams', {
      headers: authHeaders(),
    });
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /teams returns 400 for missing name', async () => {
    const res = await request('/teams', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('GET /credentials/status returns status (requires DB)', async () => {
    const res = await request('/credentials/status', {
      headers: authHeaders(),
    });
    if (!hasDb) { expect(res.status).toBe(500); return; }
    expect(res.status).toBe(200);
  });

  it('GET /api/v1/status returns phase info', async () => {
    const res = await request('/api/v1/status', {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.phase).toBe(7);
  });

  it('GET /api/auth/me returns current user from token', async () => {
    const res = await request('/api/auth/me', {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('test@example.com');
    expect(body.user.id).toBe('test_user_1');
  });
});

describe('Auth middleware', () => {
  it('rejects expired tokens', async () => {
    // Manually create an expired token
    const crypto = require('crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
      sub: 'user_1',
      email: 'test@example.com',
      plan: 'free',
      iat: Math.floor(Date.now() / 1000) - 86400,
      exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
    })).toString('base64url');
    const data = `${header}.${body}`;
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const expiredToken = `${data}.${sig}`;

    const res = await request('/billing/credits', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects invalid bearer format', async () => {
    const res = await request('/billing/credits', {
      headers: { Authorization: 'InvalidFormat token' },
    });
    expect(res.status).toBe(401);
  });
});

describe('Public invite lookup', () => {
  const hasDb = !!process.env.DATABASE_URL;

  it('GET /invite/:code returns invite details (requires DB)', async () => {
    const res = await request('/invite/abc123');
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    // With a real DB, unknown code returns 404
    expect([200, 404]).toContain(res.status);
    const body = await res.json();
    expect(body.code).toBe('abc123');
  });
});

describe('Team member operations', () => {
  it('PATCH /teams/:id/members/:userId rejects invalid role', async () => {
    const res = await request('/teams/team_123/members/user_456', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ role: 'superadmin' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /teams/:id/members self-removal returns 400', async () => {
    // The route checks actorId === targetUserId — actor is test_user_1
    const res = await request('/teams/team_123/members/test_user_1', {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /teams/:id/members/:userId accepts valid role (requires DB)', async () => {
    const hasDb = !!process.env.DATABASE_URL;
    const res = await request('/teams/team_123/members/user_456', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ role: 'admin' }),
    });
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('admin');
  });
});

describe('Feishu webhook', () => {
  it('POST /channels/feishu/webhook accepts message', async () => {
    const res = await request('/channels/feishu/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge: 'test_challenge',
      }),
    });
    // Should respond (either challenge or 200)
    expect(res.status).toBeLessThan(500);
  });
});

describe('Global error handling', () => {
  it('Malformed JSON body returns 400 instead of 500', async () => {
    const res = await request('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json!!!',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('JSON');
  });
});

describe('Stripe webhook', () => {
  it('POST /billing/webhook accepts request', async () => {
    const res = await request('/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'test' }),
    });
    // Won't have valid Stripe signature, but should not 500
    expect(res.status).toBeLessThan(500);
  });
});

// ─── Engine Chat ────────────────────────────────────────────

describe('Engine chat endpoint', () => {
  const hasDb = !!process.env.DATABASE_URL;

  it('POST /engine/chat returns 401 without token', async () => {
    const res = await request('/engine/chat', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('POST /engine/chat returns 400 for missing message', async () => {
    const res = await request('/engine/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    if (!hasDb) {
      // consumeCredits will fail without DB — returns 500
      expect(res.status).toBeGreaterThanOrEqual(400);
      return;
    }
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Message is required');
  });

  it('POST /engine/chat returns 400 for empty/whitespace message', async () => {
    const res = await request('/engine/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message: '   ' }),
    });
    if (!hasDb) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      return;
    }
    expect(res.status).toBe(400);
  });

  it('POST /engine/chat returns 402 or 503 with valid message (requires DB)', async () => {
    // Without ANTHROPIC_API_KEY: 503 (after credits pass).
    // Without credits row: consumeCredits returns { success: false } → 402.
    const res = await request('/engine/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message: 'Hello' }),
    });
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    // Either 402 (no credits) or 503 (no API key) depending on credit state
    expect([402, 503]).toContain(res.status);
  });
});

// ─── Scheduler ──────────────────────────────────────────────

describe('Scheduler task endpoints', () => {
  const hasDb = !!process.env.DATABASE_URL;

  it('POST /scheduler/tasks returns 401 without token', async () => {
    const res = await request('/scheduler/tasks', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('GET /scheduler/tasks returns 401 without token', async () => {
    const res = await request('/scheduler/tasks');
    expect(res.status).toBe(401);
  });

  it('POST /scheduler/tasks returns 400 for missing fields', async () => {
    const res = await request('/scheduler/tasks', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Test' }),
    });
    if (!hasDb) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      return;
    }
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('required');
  });

  it('POST /scheduler/tasks returns 400 for empty name', async () => {
    const res = await request('/scheduler/tasks', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: '', cronExpression: '*/5 * * * *', type: 'reminder' }),
    });
    if (!hasDb) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      return;
    }
    expect(res.status).toBe(400);
  });

  it('POST /scheduler/tasks creates a task (requires DB)', async () => {
    const res = await request('/scheduler/tasks', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'Daily Standup Reminder',
        cronExpression: '0 10 * * *',
        timezone: 'Asia/Shanghai',
        type: 'reminder',
        config: { message: 'Time for standup!' },
      }),
    });
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^ctask_/);
    expect(body.name).toBe('Daily Standup Reminder');
    expect(body.cronExpression).toBe('0 10 * * *');
    expect(body.type).toBe('reminder');
    expect(body.enabled).toBe(true);
  });

  it('GET /scheduler/tasks lists user tasks (requires DB)', async () => {
    const res = await request('/scheduler/tasks', {
      headers: authHeaders(),
    });
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('PATCH /scheduler/tasks/:id returns 404 for non-existent task', async () => {
    const res = await request('/scheduler/tasks/ctask_nonexistent', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Updated' }),
    });
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    expect(res.status).toBe(404);
  });

  it('DELETE /scheduler/tasks/:id returns 404 for non-existent task', async () => {
    const res = await request('/scheduler/tasks/ctask_nonexistent', {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    expect(res.status).toBe(404);
  });
});

// ─── V1 Compat Agent Routes (real user flow) ─────────────────
// Simulates the exact flow from shell.html/chat.html:
// 1. POST /api/auth/local → get token
// 2. Use token for /api/agent/* calls

describe('V1 compat: full user flow', () => {
  let userToken: string;

  it('Step 1: POST /api/auth/local → get token (no auth)', async () => {
    const res = await request('/api/auth/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'v1tester', display_name: 'V1 Tester' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.name).toBe('V1 Tester');
    userToken = body.token;
  });

  it('Step 2: GET /api/system/setup-status (no auth)', async () => {
    const res = await request('/api/system/setup-status');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.done).toBe(true);
    expect(body.mode).toBe('solo');
  });

  it('Step 3: GET /api/agent/engines with token', async () => {
    const res = await request('/api/agent/engines', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.default).toBe('jowork-cloud');
    expect(body.engines).toHaveLength(1);
    expect(body.engines[0].id).toBe('jowork-cloud');
    expect(body.engines[0].installed).toBe(true);
  });

  it('Step 4: GET /api/agent/sessions returns empty list (requires DB)', async () => {
    const hasDb = !!process.env.DATABASE_URL;
    const res = await request('/api/agent/sessions', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!hasDb) { expect(res.status).toBe(500); return; }
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toBeDefined();
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('Step 5: GET /api/agent/preferences returns empty prefs', async () => {
    const res = await request('/api/agent/preferences', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  it('Step 6: POST /api/agent/preferences stores prefs', async () => {
    const res = await request('/api/agent/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ theme: 'dark', language: 'zh' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('Step 7: POST /api/agent/engine (no-op compat)', async () => {
    const res = await request('/api/agent/engine', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ engine: 'jowork-cloud' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('Step 8: GET /api/agent/tasks returns empty', async () => {
    const res = await request('/api/agent/tasks', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toEqual([]);
  });

  it('Step 9: POST /api/agent/stop returns ok', async () => {
    const res = await request('/api/agent/stop', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('Step 10: GET /api/agent/sessions/search with empty query', async () => {
    const res = await request('/api/agent/sessions/search?q=', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });
});

describe('V1 compat: auth required', () => {
  it('GET /api/agent/engines returns 401 without token', async () => {
    const res = await request('/api/agent/engines');
    expect(res.status).toBe(401);
  });

  it('POST /api/agent/chat returns 401 without token', async () => {
    const res = await request('/api/agent/chat', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('GET /api/agent/sessions returns 401 without token', async () => {
    const res = await request('/api/agent/sessions');
    expect(res.status).toBe(401);
  });
});

describe('V1 compat: agent chat validation', () => {
  it('POST /api/agent/chat returns 400 for empty message', async () => {
    const res = await request('/api/agent/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message: '' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Message is required');
  });

  it('POST /api/agent/chat returns 400 for whitespace message', async () => {
    const res = await request('/api/agent/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('Scheduler execution history', () => {
  const hasDb = !!process.env.DATABASE_URL;

  it('GET /scheduler/executions/:taskId returns 401 without token', async () => {
    const res = await request('/scheduler/executions/ctask_123');
    expect(res.status).toBe(401);
  });

  it('GET /scheduler/executions/:taskId returns 404 for non-existent task', async () => {
    const res = await request('/scheduler/executions/ctask_nonexistent', {
      headers: authHeaders(),
    });
    if (!hasDb) {
      expect(res.status).toBe(500);
      return;
    }
    expect(res.status).toBe(404);
  });
});

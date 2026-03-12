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

  it('POST /auth/refresh without body returns error', async () => {
    const res = await request('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Should return some error for missing refresh token
    expect(res.status).toBeLessThan(500);
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

  it('POST /teams returns 401 without token', async () => {
    const res = await request('/teams', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('GET /credentials/status returns 401 without token', async () => {
    const res = await request('/credentials/status');
    expect(res.status).toBe(401);
  });
});

describe('Protected routes with valid auth', () => {
  it('GET /billing/credits returns credits', async () => {
    const res = await request('/billing/credits', {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('totalAvailable');
  });

  it('POST /teams creates a team', async () => {
    const res = await request('/teams', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Test Team' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Test Team');
    expect(body.id).toMatch(/^team_/);
    expect(body.inviteCode).toBeTruthy();
  });

  it('POST /teams returns 400 for missing name', async () => {
    const res = await request('/teams', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('GET /credentials/status returns status', async () => {
    const res = await request('/credentials/status', {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
  });

  it('GET /api/v1/status returns phase info', async () => {
    const res = await request('/api/v1/status', {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.phase).toBe(6);
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
  it('GET /teams/invite/:code returns invite details', async () => {
    const res = await request('/teams/invite/abc123');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe('abc123');
    expect(body.valid).toBe(true);
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

  it('PATCH /teams/:id/members/:userId accepts valid role', async () => {
    const res = await request('/teams/team_123/members/user_456', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ role: 'admin' }),
    });
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

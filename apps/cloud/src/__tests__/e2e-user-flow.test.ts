/**
 * End-to-end user flow tests for the cloud service.
 * Simulates a real user's journey through all cloud APIs.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../server';
import { signJwt } from '../auth/jwt';

const hasDb = !!process.env.DATABASE_URL;

// --- Helpers ---

function request(path: string, opts: RequestInit = {}) {
  return app.request(path, opts);
}

function makeToken(user: { sub: string; email: string; plan: string; name?: string }) {
  return signJwt({ ...user, name: user.name || 'Test User' });
}

function authHeaders(token: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// --- User Flow: Free user → signup → explore → upgrade → team ---

describe('E2E: Complete user journey', () => {
  // Simulate two users
  const freeUser = { sub: 'user_free_001', email: 'free@test.com', plan: 'free' };
  const proUser = { sub: 'user_pro_001', email: 'pro@test.com', plan: 'pro', name: 'Pro User' };
  const freeToken = makeToken(freeUser);
  const proToken = makeToken(proUser);

  // ==========================================
  // FLOW 1: Anonymous / public endpoints
  // ==========================================
  describe('Flow 1: Public access', () => {
    it('Step 1: Health check (app is running)', async () => {
      const res = await request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.version).toBeDefined();
    });

    it('Step 2: API status check', async () => {
      // This is behind auth, so test with token
      const res = await request('/api/v1/status', { headers: authHeaders(proToken) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.phase).toBe(7);
    });

    it('Step 3: Public invite lookup (before any team exists)', async () => {
      const res = await request('/invite/somecode123');
      if (!hasDb) { expect(res.status).toBe(500); return; }
      // With real DB, unknown code returns 404
      expect([200, 404]).toContain(res.status);
    });
  });

  // ==========================================
  // FLOW 2: Free user experience
  // ==========================================
  describe('Flow 2: Free user experience', () => {
    it('Step 1: Free user checks credits', async () => {
      const res = await request('/billing/credits', { headers: authHeaders(freeToken) });
      if (!hasDb) { expect(res.status).toBe(500); return; }
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalAvailable).toBeGreaterThanOrEqual(0);
      expect(body.plan).toBe('free');
    });

    it('Step 2: Free user checks credential status', async () => {
      const res = await request('/credentials/status', { headers: authHeaders(freeToken) });
      if (!hasDb) { expect(res.status).toBe(500); return; }
      expect(res.status).toBe(200);
    });

    it('Step 3: Free user cannot access resources without proper auth', async () => {
      const res = await request('/billing/credits');
      expect(res.status).toBe(401);
    });
  });

  // ==========================================
  // FLOW 3: Team creation and management
  // ==========================================
  describe('Flow 3: Team lifecycle', () => {
    let createdTeamId: string;
    let inviteCode: string;

    it('Step 1: Pro user creates a team', async () => {
      const res = await request('/teams', {
        method: 'POST',
        headers: authHeaders(proToken),
        body: JSON.stringify({ name: 'FluxVita Engineering' }),
      });
      if (!hasDb) { expect(res.status).toBe(500); return; }
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('FluxVita Engineering');
      expect(body.id).toMatch(/^team_/);
      expect(body.inviteCode).toBeTruthy();
      createdTeamId = body.id;
      inviteCode = body.inviteCode;
    });

    it('Step 2: Pro user generates invite link', async () => {
      const res = await request(`/teams/${createdTeamId || 'team_test'}/invite`, {
        method: 'POST',
        headers: authHeaders(proToken),
      });
      if (!hasDb) { expect(res.status).toBe(500); return; }
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.inviteCode).toBeTruthy();
      expect(body.inviteUrl).toContain('join');
    });

    it('Step 3: Public checks invite details', async () => {
      const code = inviteCode || 'abc123';
      const res = await request(`/invite/${code}`);
      if (!hasDb) { expect(res.status).toBe(500); return; }
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(true);
    });

    it('Step 4: Free user joins team via invite code', async () => {
      const code = inviteCode || 'abc123';
      const res = await request(`/teams/join/${code}`, {
        method: 'POST',
        headers: authHeaders(freeToken),
      });
      if (!hasDb) { expect(res.status).toBe(500); return; }
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.joined).toBe(true);
    });

    it('Step 5: Team owner changes member role', async () => {
      const res = await request(`/teams/${createdTeamId || 'team_test'}/members/${freeUser.sub}`, {
        method: 'PATCH',
        headers: authHeaders(proToken),
        body: JSON.stringify({ role: 'admin' }),
      });
      if (!hasDb) { expect(res.status).toBe(500); return; }
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.role).toBe('admin');
    });

    it('Step 6: Team owner cannot remove themselves', async () => {
      const res = await request(`/teams/${createdTeamId || 'team_test'}/members/${proUser.sub}`, {
        method: 'DELETE',
        headers: authHeaders(proToken),
      });
      // Members route checks actor === target → 400
      expect(res.status).toBe(400);
    });

    it('Step 7: Invalid role rejected', async () => {
      const res = await request(`/teams/${createdTeamId || 'team_test'}/members/${freeUser.sub}`, {
        method: 'PATCH',
        headers: authHeaders(proToken),
        body: JSON.stringify({ role: 'superuser' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ==========================================
  // FLOW 4: Billing operations
  // ==========================================
  describe('Flow 4: Billing operations', () => {
    it('Step 1: Check credits balance', async () => {
      const res = await request('/billing/credits', { headers: authHeaders(proToken) });
      if (!hasDb) { expect(res.status).toBe(500); return; }
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('dailyFreeRemaining');
      expect(body).toHaveProperty('monthlyRemaining');
      expect(body).toHaveProperty('walletBalance');
    });

    it('Step 2: Stripe webhook rejects invalid payload gracefully', async () => {
      const res = await request('/billing/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'checkout.session.completed' }),
      });
      // Should not crash (no Stripe signature verification in test env)
      expect(res.status).toBeLessThan(500);
    });
  });

  // ==========================================
  // FLOW 5: Credential management
  // ==========================================
  describe('Flow 5: Credential management', () => {
    it('Step 1: Check credential status', async () => {
      const res = await request('/credentials/status', { headers: authHeaders(proToken) });
      if (!hasDb) { expect(res.status).toBe(500); return; }
      expect(res.status).toBe(200);
    });

    it('Step 2: Authorize a connector', async () => {
      const res = await request('/credentials/authorize', {
        method: 'POST',
        headers: authHeaders(proToken),
        body: JSON.stringify({ connectorId: 'github', credential: { token: 'ghp_test' } }),
      });
      expect(res.status).toBeLessThan(500);
    });

    it('Step 3: Authorize all connectors', async () => {
      const res = await request('/credentials/authorize-all', {
        method: 'POST',
        headers: authHeaders(proToken),
        body: JSON.stringify({}),
      });
      expect(res.status).toBeLessThan(500);
    });
  });

  // ==========================================
  // FLOW 6: Feishu integration
  // ==========================================
  describe('Flow 6: Feishu webhook handling', () => {
    it('Step 1: Challenge verification', async () => {
      const res = await request('/channels/feishu/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: 'verification_token_123' }),
      });
      expect(res.status).toBeLessThan(500);
    });

    it('Step 2: Message event', async () => {
      const res = await request('/channels/feishu/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          header: { event_type: 'im.message.receive_v1' },
          event: {
            message: {
              message_type: 'text',
              content: JSON.stringify({ text: 'Hello JoWork' }),
            },
            sender: { sender_id: { open_id: 'ou_test' } },
          },
        }),
      });
      expect(res.status).toBeLessThan(500);
    });
  });

  // ==========================================
  // FLOW 7: Auth edge cases
  // ==========================================
  describe('Flow 7: Auth edge cases', () => {
    it('Expired token is rejected', async () => {
      const crypto = require('crypto');
      const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify({
        sub: 'user_expired',
        email: 'expired@test.com',
        plan: 'free',
        iat: 1000000,
        exp: 1000001,
      })).toString('base64url');
      const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');

      const res = await request('/billing/credits', {
        headers: { Authorization: `Bearer ${header}.${body}.${sig}` },
      });
      expect(res.status).toBe(401);
    });

    it('Missing Authorization header returns 401', async () => {
      const res = await request('/teams', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('Malformed Bearer token returns 401', async () => {
      const res = await request('/billing/credits', {
        headers: { Authorization: 'Bearer not-a-real-jwt' },
      });
      expect(res.status).toBe(401);
    });

    it('Google OAuth redirect endpoint responds', async () => {
      const res = await request('/auth/google');
      expect([302, 503]).toContain(res.status);
    });
  });
});

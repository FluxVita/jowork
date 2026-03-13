import type { Context } from 'hono';
import { createHmac, randomBytes } from 'crypto';
import { eq, or } from 'drizzle-orm';
import { signJwt } from './jwt';
import { getDb } from '../db';
import { users } from '../db/schema';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.AUTH_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
const WEB_APP_URL = (process.env.APP_URL || process.env.JOWORK_APP_URL || 'https://jowork.work').replace(/\/+$/, '');
const STATE_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

type OAuthMode = 'desktop' | 'web';

function hasGoogleOAuth(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function getOAuthMode(c: Context): OAuthMode {
  return c.req.query('mode') === 'desktop' ? 'desktop' : 'web';
}

/** Encode state with HMAC signature to prevent CSRF forgery. */
function encodeState(mode: OAuthMode): string {
  const nonce = randomBytes(8).toString('hex');
  const payload = JSON.stringify({ mode, nonce });
  const sig = createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(`${sig}:${payload}`, 'utf-8').toString('base64url');
}

/** Decode and verify signed state. Returns mode or null if tampered. */
function decodeState(state: string | undefined): OAuthMode | null {
  if (!state) return null;
  try {
    const raw = Buffer.from(state, 'base64url').toString('utf-8');
    const colonIdx = raw.indexOf(':');
    if (colonIdx === -1) return null;
    const sig = raw.slice(0, colonIdx);
    const payload = raw.slice(colonIdx + 1);
    const expected = createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 16);
    if (sig !== expected) return null;
    const parsed = JSON.parse(payload) as { mode?: string };
    return parsed.mode === 'desktop' ? 'desktop' : 'web';
  } catch {
    return null;
  }
}

function buildGoogleAuthUrl(mode: OAuthMode): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state: encodeState(mode),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Redirect to Google OAuth consent screen.
 */
export function googleLogin(c: Context): Response {
  if (!hasGoogleOAuth()) {
    return c.json({ error: 'Google login is not configured' }, 503);
  }

  return c.redirect(buildGoogleAuthUrl(getOAuthMode(c)));
}

export function getGoogleStatus(c: Context): Response {
  return c.json({
    enabled: hasGoogleOAuth(),
    provider: 'google',
  });
}

export function getOAuthUrl(c: Context): Response {
  if (!hasGoogleOAuth()) {
    return c.json({
      enabled: false,
      error: 'Google login is not configured',
    });
  }

  return c.json({
    enabled: true,
    provider: 'google',
    url: buildGoogleAuthUrl(getOAuthMode(c)),
  });
}

/**
 * Handle Google OAuth callback: exchange code for tokens, create/update user, issue JWT.
 */
export async function googleCallback(c: Context): Promise<Response> {
  const code = c.req.query('code');
  if (!code) {
    return c.json({ error: 'Missing authorization code' }, 400);
  }

  const mode = decodeState(c.req.query('state'));
  if (mode === null) {
    return c.json({ error: 'Invalid or missing state parameter' }, 400);
  }

  try {
    // Exchange code for Google tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return c.json({ error: 'Token exchange failed' }, 400);
    }

    const tokens = await tokenRes.json() as { access_token: string; id_token: string };

    // Get user info from Google
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const googleUser = await userRes.json() as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };

    // Upsert user in database
    const googleScopedUserId = `user_${googleUser.id}`;
    const db = getDb();

    const [existing] = await db.select().from(users).where(
      or(
        eq(users.id, googleScopedUserId),
        eq(users.email, googleUser.email),
      ),
    );

    const userId = existing?.id || googleScopedUserId;
    const isNewUser = !existing;
    let plan = 'free';

    if (existing) {
      // Update existing user
      await db.update(users).set({
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
        updatedAt: new Date(),
      }).where(eq(users.id, userId));
      plan = existing.plan;
    } else {
      // Create new user
      await db.insert(users).values({
        id: userId,
        email: googleUser.email,
        name: googleUser.name,
        avatarUrl: googleUser.picture,
        plan: 'free',
      });
    }

    // Issue JoWork JWT
    const jwt = signJwt({
      sub: userId,
      email: googleUser.email,
      name: googleUser.name,
      avatar_url: googleUser.picture,
      plan,
    });

    const callbackUrl = mode === 'desktop'
      ? `${WEB_APP_URL}/auth/callback?token=${encodeURIComponent(jwt)}`
      : `${WEB_APP_URL}${isNewUser ? '/onboarding.html' : '/shell.html'}?token=${encodeURIComponent(jwt)}`;

    return c.redirect(callbackUrl);
  } catch (err) {
    console.error('[OAuth] Callback error:', err);
    return c.json({ error: 'Authentication failed' }, 500);
  }
}

/**
 * Refresh JWT token. Validates the old token is still recent, looks up user, issues new JWT.
 */
export async function refreshToken(c: Context): Promise<Response> {
  let token: string | undefined;
  try {
    const body = await c.req.json();
    token = body.token || body.refreshToken;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!token) {
    return c.json({ error: 'Missing token' }, 400);
  }

  // Decode without full verification (we accept recently expired tokens for refresh)
  try {
    const [, body] = (token as string).split('.');
    if (!body) return c.json({ error: 'Invalid token format' }, 400);

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as {
      sub: string;
      exp: number;
    };

    // Only allow refresh within 30 days of expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now - 30 * 24 * 60 * 60) {
      return c.json({ error: 'Token too old to refresh' }, 401);
    }

    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, payload.sub));
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const newJwt = signJwt({
      sub: user.id,
      email: user.email,
      name: user.name ?? undefined,
      avatar_url: user.avatarUrl ?? undefined,
      plan: user.plan,
    });

    return c.json({ token: newJwt });
  } catch {
    return c.json({ error: 'Invalid token' }, 400);
  }
}

import type { Context } from 'hono';
import { signJwt } from './jwt';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.AUTH_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

/**
 * Redirect to Google OAuth consent screen.
 */
export function googleLogin(c: Context): Response {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

/**
 * Handle Google OAuth callback: exchange code for tokens, create/update user, issue JWT.
 */
export async function googleCallback(c: Context): Promise<Response> {
  const code = c.req.query('code');
  if (!code) {
    return c.json({ error: 'Missing authorization code' }, 400);
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

    // TODO: upsert user in database
    const userId = `user_${googleUser.id}`;

    // Issue JoWork JWT
    const jwt = signJwt({
      sub: userId,
      email: googleUser.email,
      name: googleUser.name,
      avatar_url: googleUser.picture,
      plan: 'free',
    });

    // Redirect back to desktop app with token
    const callbackUrl = `jowork://auth/callback?token=${encodeURIComponent(jwt)}`;
    return c.redirect(callbackUrl);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
}

/**
 * Refresh JWT token.
 */
export async function refreshToken(c: Context): Promise<Response> {
  const { refreshToken } = await c.req.json();
  if (!refreshToken) {
    return c.json({ error: 'Missing refresh token' }, 400);
  }

  // TODO: validate refresh token, look up user, issue new JWT
  return c.json({ error: 'Not implemented' }, 501);
}

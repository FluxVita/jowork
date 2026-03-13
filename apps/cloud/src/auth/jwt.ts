/**
 * JWT utility functions for cloud auth.
 * Uses simple HMAC-SHA256 signing.
 */
import { createHmac } from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

// Warn loudly if using default secret in production
if (JWT_SECRET === 'dev-secret-change-me' && process.env.NODE_ENV === 'production') {
  console.error('[CRITICAL] JWT_SECRET is using the default value in production! Set JWT_SECRET env var.');
  process.exit(1);
}

interface JwtPayload {
  sub: string;
  email: string;
  name?: string;
  avatar_url?: string;
  plan: string;
  iat: number;
  exp: number;
}

function base64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_EXPIRY,
  };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(fullPayload));
  const data = `${header}.${body}`;

  // Simple HMAC signature
  const signature = createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64url');

  return `${data}.${signature}`;
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;

    // Verify signature
    const expected = createHmac('sha256', JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (signature !== expected) return null;

    const payload: JwtPayload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf-8'),
    );

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

import type { Context } from 'hono';
import { signJwt, verifyJwt } from './jwt';

interface CompatUser {
  id: string;
  email: string;
  name: string;
  plan: string;
  avatar_url?: string;
  role: 'admin';
}

function normalizeHandle(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'local_user';
}

function buildLocalUser(input: { username?: string; display_name?: string; feishu_open_id?: string; name?: string }): CompatUser {
  const rawHandle = input.username || input.feishu_open_id || input.name || 'local_user';
  const handle = normalizeHandle(rawHandle);
  const displayName = (input.display_name || input.name || input.username || handle).trim() || 'Local User';

  return {
    id: `local_${handle}`,
    email: `${handle}@local.jowork.work`,
    name: displayName,
    plan: 'free',
    role: 'admin',
  };
}

function issueCompatAuth(c: Context, user: CompatUser): Response {
  const token = signJwt({
    sub: user.id,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url,
    plan: user.plan,
  });

  return c.json({
    token,
    user,
  });
}

export async function localLogin(c: Context): Promise<Response> {
  const body = await c.req.json<{
    username?: string;
    display_name?: string;
  }>();

  if (!body.username?.trim() || body.username.trim().length < 2) {
    return c.json({ error: 'Username must be at least 2 characters' }, 400);
  }

  return issueCompatAuth(c, buildLocalUser(body));
}

export async function compatLogin(c: Context): Promise<Response> {
  const body = await c.req.json<{
    feishu_open_id?: string;
    name?: string;
    challenge_id?: string;
    code?: string;
  }>();

  if (!body.feishu_open_id?.trim() || !body.name?.trim()) {
    return c.json({ error: 'Missing feishu_open_id or name' }, 400);
  }

  return issueCompatAuth(c, buildLocalUser(body));
}

export function getCurrentUser(c: Context): Response {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401);
  }

  const payload = verifyJwt(authHeader.slice(7));
  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  return c.json({
    user: {
      id: payload.sub,
      email: payload.email,
      name: payload.name || payload.email,
      avatar_url: payload.avatar_url,
      plan: payload.plan,
      role: 'admin',
    },
  });
}

export function getSetupStatus(c: Context): Response {
  const baseUrl = (process.env.APP_URL || process.env.JOWORK_APP_URL || 'https://jowork.work').replace(/\/+$/, '');
  return c.json({
    done: true,
    gateway_url: baseUrl,
    mode: 'solo',
    remote_gateway_url: '',
    oauth_callbacks: {
      google: `${baseUrl}/api/auth/google/callback`,
    },
  });
}

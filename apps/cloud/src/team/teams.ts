import type { Context } from 'hono';
import { randomBytes } from 'crypto';

/**
 * POST /teams — create a new team
 */
export async function createTeam(c: Context): Promise<Response> {
  const userId = c.get('userId');
  const { name } = await c.req.json();

  if (!name?.trim()) {
    return c.json({ error: 'Team name required' }, 400);
  }

  const teamId = `team_${randomBytes(8).toString('hex')}`;
  const inviteCode = randomBytes(6).toString('hex');

  // TODO: insert into teams table + add owner as member
  const team = {
    id: teamId,
    name: name.trim(),
    ownerId: userId,
    inviteCode,
    createdAt: new Date().toISOString(),
  };

  return c.json(team, 201);
}

/**
 * GET /teams/:id — get team details
 */
export async function getTeam(c: Context): Promise<Response> {
  const teamId = c.req.param('id');
  const _userId = c.get('userId');

  // TODO: query from DB, check membership
  return c.json({
    id: teamId,
    name: 'Placeholder Team',
    members: [],
  });
}

/**
 * POST /teams/:id/invite — generate invite link
 */
export async function createInvite(c: Context): Promise<Response> {
  const teamId = c.req.param('id');
  const _userId = c.get('userId');

  // TODO: check user is owner/admin
  const inviteCode = randomBytes(6).toString('hex');

  return c.json({
    teamId,
    inviteCode,
    inviteUrl: `https://app.jowork.dev/join/${inviteCode}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

/**
 * POST /teams/join/:code — join team via invite code
 */
export async function joinTeam(c: Context): Promise<Response> {
  const code = c.req.param('code');
  const userId = c.get('userId');

  // TODO: look up team by invite code, add member
  return c.json({
    joined: true,
    code,
    userId,
  });
}

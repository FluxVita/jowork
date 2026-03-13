import type { Context } from 'hono';
import { randomBytes } from 'crypto';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { teams, teamMembers } from '../db/schema';

function getInviteBaseUrl(): string {
  return (process.env.APP_URL || process.env.JOWORK_APP_URL || 'https://jowork.work').replace(/\/+$/, '');
}

/**
 * GET /teams — list teams for current user
 */
export async function listTeams(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const db = getDb();

  const memberships = await db.select({
    teamId: teamMembers.teamId,
    role: teamMembers.role,
    joinedAt: teamMembers.joinedAt,
  }).from(teamMembers).where(eq(teamMembers.userId, userId));

  if (memberships.length === 0) {
    return c.json([]);
  }

  const teamIds = memberships.map((m) => m.teamId);
  const userTeams = await db.select().from(teams).where(inArray(teams.id, teamIds));
  const teamsById = new Map(userTeams.map((team) => [team.id, team]));

  return c.json(
    memberships
      .map((membership) => {
        const team = teamsById.get(membership.teamId);
        if (!team) return null;
        return {
          ...team,
          role: membership.role,
          joinedAt: membership.joinedAt,
        };
      })
      .filter(Boolean),
  );
}

/**
 * POST /teams — create a new team
 */
export async function createTeam(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const { name } = await c.req.json();

  if (!name?.trim()) {
    return c.json({ error: 'Team name required' }, 400);
  }
  if (name.length > 100) {
    return c.json({ error: 'Team name must be <= 100 characters' }, 400);
  }

  const db = getDb();
  const teamId = `team_${randomBytes(8).toString('hex')}`;
  const inviteCode = randomBytes(6).toString('hex');

  const [team] = await db.insert(teams).values({
    id: teamId,
    name: name.trim(),
    ownerId: userId,
    inviteCode,
  }).returning();

  // Add creator as owner member
  await db.insert(teamMembers).values({
    teamId,
    userId,
    role: 'owner',
  });

  return c.json(team, 201);
}

/**
 * GET /teams/:id — get team details
 */
export async function getTeam(c: Context): Promise<Response> {
  const teamId = c.req.param('id') as string;
  const userId = c.get('userId') as string;
  const db = getDb();

  // Check membership
  const [membership] = await db.select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));

  if (!membership) {
    return c.json({ error: 'Not a member of this team' }, 403);
  }

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team) {
    return c.json({ error: 'Team not found' }, 404);
  }

  const members = await db.select({
    userId: teamMembers.userId,
    role: teamMembers.role,
    joinedAt: teamMembers.joinedAt,
  }).from(teamMembers).where(eq(teamMembers.teamId, teamId));

  return c.json({ ...team, members });
}

/**
 * POST /teams/:id/invite — generate invite link
 */
export async function createInvite(c: Context): Promise<Response> {
  const teamId = c.req.param('id') as string;
  const userId = c.get('userId') as string;
  const db = getDb();

  // Check user is owner or admin
  const [membership] = await db.select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));

  if (!membership || membership.role === 'member') {
    return c.json({ error: 'Only owners and admins can create invites' }, 403);
  }

  const inviteCode = randomBytes(6).toString('hex');

  await db.update(teams)
    .set({ inviteCode })
    .where(eq(teams.id, teamId));

  return c.json({
    teamId,
    inviteCode,
    inviteUrl: `${getInviteBaseUrl()}/join/${inviteCode}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

/**
 * POST /teams/join/:code — join team via invite code
 */
export async function joinTeam(c: Context): Promise<Response> {
  const code = c.req.param('code') as string;
  const userId = c.get('userId') as string;
  const db = getDb();

  const [team] = await db.select().from(teams).where(eq(teams.inviteCode, code));
  if (!team) {
    return c.json({ error: 'Invalid invite code' }, 404);
  }

  // Check if already a member
  const [existing] = await db.select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)));

  if (existing) {
    return c.json({ error: 'Already a member of this team' }, 409);
  }

  await db.insert(teamMembers).values({
    teamId: team.id,
    userId,
    role: 'member',
  });

  return c.json({
    joined: true,
    teamId: team.id,
    teamName: team.name,
  });
}

import type { Context } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { teams, teamMembers } from '../db/schema';

/**
 * GET /teams/invite/:code — get invite details (public, no auth required)
 */
export async function getInviteDetails(c: Context): Promise<Response> {
  const code = c.req.param('code') as string;
  const db = getDb();

  const [team] = await db.select().from(teams).where(eq(teams.inviteCode, code));
  if (!team) {
    return c.json({ code, valid: false }, 404);
  }

  const [countRow] = await db.select({
    count: sql<number>`count(*)`,
  }).from(teamMembers).where(eq(teamMembers.teamId, team.id));

  return c.json({
    code,
    teamName: team.name,
    memberCount: countRow?.count ?? 0,
    valid: true,
  });
}

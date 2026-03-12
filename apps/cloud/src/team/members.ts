import type { Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db';
import { teams, teamMembers } from '../db/schema';

/**
 * DELETE /teams/:id/members/:userId — remove a team member
 */
export async function removeMember(c: Context): Promise<Response> {
  const teamId = c.req.param('id') as string;
  const targetUserId = c.req.param('userId') as string;
  const actorId = c.get('userId') as string;

  if (targetUserId === actorId) {
    return c.json({ error: 'Cannot remove yourself. Transfer ownership first.' }, 400);
  }

  const db = getDb();

  // Check actor is owner or admin
  const [actor] = await db.select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, actorId)));

  if (!actor || actor.role === 'member') {
    return c.json({ error: 'Only owners and admins can remove members' }, 403);
  }

  // Cannot remove the owner
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (team && targetUserId === team.ownerId) {
    return c.json({ error: 'Cannot remove the team owner' }, 403);
  }

  await db.delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));

  return c.json({ removed: true, teamId, userId: targetUserId });
}

/**
 * PATCH /teams/:id/members/:userId — update member role
 */
export async function updateMemberRole(c: Context): Promise<Response> {
  const teamId = c.req.param('id') as string;
  const targetUserId = c.req.param('userId') as string;
  const actorId = c.get('userId') as string;
  const { role } = await c.req.json();

  if (!['admin', 'member'].includes(role)) {
    return c.json({ error: 'Invalid role. Must be admin or member.' }, 400);
  }

  const db = getDb();

  // Only owner can change roles
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team || team.ownerId !== actorId) {
    return c.json({ error: 'Only the team owner can change roles' }, 403);
  }

  // Cannot change owner's own role
  if (targetUserId === team.ownerId) {
    return c.json({ error: 'Cannot change the owner role' }, 400);
  }

  await db.update(teamMembers)
    .set({ role })
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));

  return c.json({ updated: true, teamId, userId: targetUserId, role });
}

import type { Context } from 'hono';

/**
 * DELETE /teams/:id/members/:userId — remove a team member
 */
export async function removeMember(c: Context): Promise<Response> {
  const teamId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  const actorId = c.get('userId');

  // TODO: check actor is owner/admin, cannot remove owner
  if (targetUserId === actorId) {
    return c.json({ error: 'Cannot remove yourself. Transfer ownership first.' }, 400);
  }

  // TODO: delete from team_members
  return c.json({ removed: true, teamId, userId: targetUserId });
}

/**
 * PATCH /teams/:id/members/:userId — update member role
 */
export async function updateMemberRole(c: Context): Promise<Response> {
  const teamId = c.req.param('id');
  const targetUserId = c.req.param('userId');
  const _actorId = c.get('userId');
  const { role } = await c.req.json();

  if (!['admin', 'member'].includes(role)) {
    return c.json({ error: 'Invalid role. Must be admin or member.' }, 400);
  }

  // TODO: check actor is owner, update role in team_members
  return c.json({ updated: true, teamId, userId: targetUserId, role });
}

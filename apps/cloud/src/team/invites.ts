import type { Context } from 'hono';

/**
 * GET /teams/invite/:code — get invite details (public, no auth required)
 */
export async function getInviteDetails(c: Context): Promise<Response> {
  const code = c.req.param('code');

  // TODO: look up team by invite_code, return team name + member count
  return c.json({
    code,
    teamName: 'Placeholder Team',
    memberCount: 1,
    valid: true,
  });
}

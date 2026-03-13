import type { Context } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import { getDb } from '../db';
import { cloudContextDocs, teamMembers } from '../db/schema';

/**
 * Verify the user is a member of the team.
 */
async function verifyTeamMember(userId: string, teamId: string): Promise<boolean> {
  const db = getDb();
  const [member] = await db.select().from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return !!member;
}

/**
 * GET /teams/:id/context-docs — list team context docs
 */
export async function listTeamContextDocs(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const teamId = c.req.param('id')!;

  const isMember = await verifyTeamMember(userId, teamId);
  if (!isMember) {
    return c.json({ error: 'Not a member of this team' }, 403);
  }

  const db = getDb();
  const docs = await db.select().from(cloudContextDocs)
    .where(eq(cloudContextDocs.teamId, teamId))
    .orderBy(desc(cloudContextDocs.priority));

  return c.json(docs);
}

/**
 * POST /teams/:id/context-docs — create a team context doc
 */
export async function createTeamContextDoc(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const teamId = c.req.param('id')!;

  const isMember = await verifyTeamMember(userId, teamId);
  if (!isMember) {
    return c.json({ error: 'Not a member of this team' }, 403);
  }

  const body = await c.req.json<{
    title: string;
    content: string;
    category?: string;
    priority?: number;
  }>();

  if (!body.title?.trim() || !body.content?.trim()) {
    return c.json({ error: 'title and content are required' }, 400);
  }
  if (body.title.length > 500) {
    return c.json({ error: 'title must be <= 500 characters' }, 400);
  }
  if (body.content.length > 50_000) {
    return c.json({ error: 'content must be <= 50000 characters' }, 400);
  }

  const db = getDb();
  const id = `tdoc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  await db.insert(cloudContextDocs).values({
    id,
    teamId,
    title: body.title,
    content: body.content,
    scope: 'team',
    category: body.category ?? 'standard',
    priority: body.priority ?? 0,
  });

  const [doc] = await db.select().from(cloudContextDocs).where(eq(cloudContextDocs.id, id));
  return c.json(doc, 201);
}

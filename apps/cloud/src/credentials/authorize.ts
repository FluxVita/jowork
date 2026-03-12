import type { Context } from 'hono';

/**
 * Credential authorization API endpoints — placeholder.
 * Full implementation in Phase 6 after auth is available.
 */

export async function authorizeConnector(c: Context): Promise<Response> {
  // POST /credentials/authorize
  const { connectorId, encryptedCredentials } = await c.req.json();
  const userId = c.get('userId');

  // TODO: use CredentialVault.authorize()
  return c.json({ ok: true, connectorId, userId });
}

export async function revokeConnector(c: Context): Promise<Response> {
  // DELETE /credentials/revoke/:id
  const connectorId = c.req.param('id');
  const userId = c.get('userId');

  // TODO: use CredentialVault.revoke()
  return c.json({ ok: true, connectorId, userId });
}

export async function authorizeAll(c: Context): Promise<Response> {
  // POST /credentials/authorize-all
  const { credentials } = await c.req.json();
  const userId = c.get('userId');

  // TODO: use CredentialVault.authorizeAll()
  return c.json({ ok: true, count: credentials?.length ?? 0, userId });
}

export async function getStatus(c: Context): Promise<Response> {
  // GET /credentials/status
  const userId = c.get('userId');

  // TODO: use CredentialVault.getStatus()
  return c.json({ connectors: [], userId });
}

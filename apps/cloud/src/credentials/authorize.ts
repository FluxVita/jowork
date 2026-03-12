import type { Context } from 'hono';
import { getDb } from '../db';
import { CredentialVault } from './vault';

function getVault() {
  return new CredentialVault(getDb());
}

/**
 * POST /credentials/authorize — store encrypted credentials for a connector
 */
export async function authorizeConnector(c: Context): Promise<Response> {
  const { connectorId, encryptedCredentials } = await c.req.json();
  const userId = c.get('userId') as string;

  if (!connectorId || !encryptedCredentials) {
    return c.json({ error: 'connectorId and encryptedCredentials are required' }, 400);
  }

  await getVault().authorize(userId, connectorId, encryptedCredentials);
  return c.json({ ok: true, connectorId, userId });
}

/**
 * DELETE /credentials/revoke/:id — revoke credentials for a connector
 */
export async function revokeConnector(c: Context): Promise<Response> {
  const connectorId = c.req.param('id') as string;
  const userId = c.get('userId') as string;

  await getVault().revoke(userId, connectorId);
  return c.json({ ok: true, connectorId, userId });
}

/**
 * POST /credentials/authorize-all — bulk authorize multiple connectors
 */
export async function authorizeAll(c: Context): Promise<Response> {
  const { credentials } = await c.req.json();
  const userId = c.get('userId') as string;

  if (!Array.isArray(credentials)) {
    return c.json({ error: 'credentials array required' }, 400);
  }

  await getVault().authorizeAll(
    userId,
    credentials.map((c: { connectorId: string; encryptedCredentials: string }) => ({
      connectorId: c.connectorId,
      encrypted: c.encryptedCredentials,
    })),
  );

  return c.json({ ok: true, count: credentials.length, userId });
}

/**
 * GET /credentials/status — list authorized connectors
 */
export async function getStatus(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;

  const connectors = await getVault().getStatus(userId);
  return c.json({ connectors, userId });
}

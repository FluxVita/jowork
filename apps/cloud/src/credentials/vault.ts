import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { cloudCredentials } from '../db/schema';

export class CredentialVault {
  constructor(private db: PostgresJsDatabase) {}

  async authorize(userId: string, connectorId: string, encryptedCredentials: string): Promise<void> {
    await this.db.insert(cloudCredentials).values({
      id: `cc_${userId}_${connectorId}`,
      userId,
      connectorId,
      encryptedCredentials,
    }).onConflictDoUpdate({
      target: cloudCredentials.id,
      set: {
        encryptedCredentials,
        authorizedAt: new Date(),
      },
    });
  }

  async revoke(userId: string, connectorId: string): Promise<void> {
    await this.db.delete(cloudCredentials).where(
      and(
        eq(cloudCredentials.userId, userId),
        eq(cloudCredentials.connectorId, connectorId),
      ),
    );
  }

  async authorizeAll(userId: string, credentials: Array<{ connectorId: string; encrypted: string }>): Promise<void> {
    for (const cred of credentials) {
      await this.authorize(userId, cred.connectorId, cred.encrypted);
    }
  }

  async getStatus(userId: string): Promise<Array<{ connectorId: string; authorizedAt: Date | null }>> {
    const rows = await this.db.select({
      connectorId: cloudCredentials.connectorId,
      authorizedAt: cloudCredentials.authorizedAt,
    }).from(cloudCredentials).where(eq(cloudCredentials.userId, userId));

    return rows;
  }

  async getCredential(userId: string, connectorId: string): Promise<string | null> {
    const row = await this.db.select().from(cloudCredentials).where(
      and(
        eq(cloudCredentials.userId, userId),
        eq(cloudCredentials.connectorId, connectorId),
      ),
    ).limit(1);

    return row[0]?.encryptedCredentials ?? null;
  }
}

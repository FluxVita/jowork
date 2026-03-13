import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { cloudCredentials } from '../db/schema';
import { encryptCredential, decryptCredential } from './crypto';

export class CredentialVault {
  constructor(private db: PostgresJsDatabase) {}

  /**
   * Store a credential encrypted with AES-256-GCM.
   * The plaintext JSON is encrypted before reaching the DB.
   */
  async authorize(userId: string, connectorId: string, plaintextCredential: string): Promise<void> {
    const encrypted = encryptCredential(plaintextCredential);
    await this.db.insert(cloudCredentials).values({
      id: `cc_${userId}_${connectorId}`,
      userId,
      connectorId,
      encryptedCredentials: encrypted,
    }).onConflictDoUpdate({
      target: cloudCredentials.id,
      set: {
        encryptedCredentials: encrypted,
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

  /**
   * Retrieve and decrypt a stored credential. Returns decrypted plaintext JSON.
   */
  async getCredential(userId: string, connectorId: string): Promise<string | null> {
    const row = await this.db.select().from(cloudCredentials).where(
      and(
        eq(cloudCredentials.userId, userId),
        eq(cloudCredentials.connectorId, connectorId),
      ),
    ).limit(1);

    const encrypted = row[0]?.encryptedCredentials;
    if (!encrypted) return null;

    try {
      return decryptCredential(encrypted);
    } catch {
      console.error(`[Vault] Failed to decrypt credential for ${userId}/${connectorId}`);
      return null;
    }
  }
}

import { safeStorage } from 'electron';
import { join } from 'path';
import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

/**
 * Credential store using Electron's safeStorage (system keychain).
 * Stores encrypted connector credentials in a local JSON file.
 */
export class CredentialStore {
  private storePath: string;
  private data: Record<string, string>;

  constructor() {
    const dir = join(app.getPath('userData'), 'credentials');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.storePath = join(dir, 'store.json');
    this.data = this.load();
  }

  private load(): Record<string, string> {
    try {
      if (existsSync(this.storePath)) {
        return JSON.parse(readFileSync(this.storePath, 'utf-8'));
      }
    } catch {
      // corrupted file, start fresh
    }
    return {};
  }

  private persist(): void {
    writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  save(connectorId: string, credentials: unknown): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption not available on this platform');
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(credentials));
    this.data[connectorId] = encrypted.toString('base64');
    this.persist();
  }

  get(connectorId: string): unknown | null {
    const encrypted = this.data[connectorId];
    if (!encrypted) return null;
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  }

  delete(connectorId: string): void {
    delete this.data[connectorId];
    this.persist();
  }

  has(connectorId: string): boolean {
    return connectorId in this.data;
  }
}

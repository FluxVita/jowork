import { safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

const TOKEN_FILE = 'auth-tokens.enc';

/**
 * Stores auth tokens encrypted via Electron safeStorage (system keychain).
 */
export class TokenStore {
  private filePath: string;

  constructor() {
    const dir = join(app.getPath('userData'), 'auth');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, TOKEN_FILE);
  }

  save(tokens: { accessToken: string; refreshToken?: string; expiresAt?: number }): void {
    const data = JSON.stringify(tokens);
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(data);
      writeFileSync(this.filePath, encrypted);
    } else {
      // Fallback: store as plain JSON (not ideal but functional)
      writeFileSync(this.filePath, data, 'utf-8');
    }
  }

  load(): { accessToken: string; refreshToken?: string; expiresAt?: number } | null {
    if (!existsSync(this.filePath)) return null;

    try {
      const raw = readFileSync(this.filePath);
      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(raw);
        return JSON.parse(decrypted);
      }
      return JSON.parse(raw.toString('utf-8'));
    } catch {
      return null;
    }
  }

  clear(): void {
    if (existsSync(this.filePath)) {
      writeFileSync(this.filePath, '');
    }
  }

  hasToken(): boolean {
    const tokens = this.load();
    return !!tokens?.accessToken;
  }

  isExpired(): boolean {
    const tokens = this.load();
    if (!tokens?.expiresAt) return false;
    return Date.now() > tokens.expiresAt;
  }
}

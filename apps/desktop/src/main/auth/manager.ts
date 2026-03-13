import { BrowserWindow } from 'electron';
import { TokenStore } from './token-store';
import { ModeManager } from './mode';
import { getApiBaseUrl } from '../config/urls';

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
  plan: string;
}

/**
 * Manages authentication state for the desktop app.
 * Supports Google OAuth login via cloud service.
 */
export class AuthManager {
  private tokenStore: TokenStore;
  private modeManager: ModeManager;
  private cloudUrl: string;
  private currentUser: AuthUser | null = null;

  constructor(
    modeManager: ModeManager,
    cloudUrl?: string,
  ) {
    this.tokenStore = new TokenStore();
    this.modeManager = modeManager;
    this.cloudUrl = cloudUrl || getApiBaseUrl();
  }

  async loginWithGoogle(): Promise<AuthUser> {
    return new Promise((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 500,
        height: 650,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      authWindow.loadURL(`${this.cloudUrl}/auth/google`);

      authWindow.webContents.on('will-redirect', async (_event, url) => {
        if (url.includes('/auth/callback')) {
          try {
            const parsedUrl = new URL(url);
            const token = parsedUrl.searchParams.get('token');
            const refreshToken = parsedUrl.searchParams.get('refresh_token');

            if (!token) {
              reject(new Error('No token received'));
              authWindow.close();
              return;
            }

            this.tokenStore.save({
              accessToken: token,
              refreshToken: refreshToken || undefined,
              expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
            });

            const user = this.decodeUser(token);
            this.currentUser = user;
            this.modeManager.setCloudUser(user.id);

            resolve(user);
            authWindow.close();
          } catch (err) {
            reject(err);
            authWindow.close();
          }
        }
      });

      authWindow.on('closed', () => {
        if (!this.currentUser) {
          reject(new Error('Auth window closed'));
        }
      });
    });
  }

  async logout(): Promise<void> {
    this.tokenStore.clear();
    this.currentUser = null;
    this.modeManager.clearCloudUser();
  }

  async refreshToken(): Promise<boolean> {
    const tokens = this.tokenStore.load();
    if (!tokens?.refreshToken) return false;

    try {
      const res = await fetch(`${this.cloudUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });

      if (!res.ok) return false;

      const data = await res.json() as { token: string; refreshToken?: string; expiresAt?: number };
      this.tokenStore.save({
        accessToken: data.token,
        refreshToken: data.refreshToken || tokens.refreshToken,
        expiresAt: data.expiresAt || Date.now() + 7 * 24 * 60 * 60 * 1000,
      });

      return true;
    } catch {
      return false;
    }
  }

  getToken(): string | null {
    const tokens = this.tokenStore.load();
    return tokens?.accessToken || null;
  }

  isLoggedIn(): boolean {
    return this.tokenStore.hasToken() && !this.tokenStore.isExpired();
  }

  getCurrentUser(): AuthUser | null {
    if (this.currentUser) return this.currentUser;

    const token = this.getToken();
    if (!token) return null;

    try {
      this.currentUser = this.decodeUser(token);
      return this.currentUser;
    } catch {
      return null;
    }
  }

  getModeManager(): ModeManager {
    return this.modeManager;
  }

  private decodeUser(token: string): AuthUser {
    // Decode JWT payload (no verification — cloud handles that)
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT');

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    );

    return {
      id: payload.sub || payload.id,
      email: payload.email,
      name: payload.name,
      avatarUrl: payload.avatar_url,
      plan: payload.plan || 'free',
    };
  }
}

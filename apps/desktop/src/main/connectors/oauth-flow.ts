import { BrowserWindow } from 'electron';

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  callbackUrl: string;
  scopes: string[];
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * OAuth authorization flow using Electron BrowserWindow.
 * Opens auth URL, intercepts redirect callback, exchanges code for tokens.
 */
export class OAuthFlow {
  async authorize(config: OAuthConfig): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      scope: config.scopes.join(' '),
      response_type: 'code',
    });

    const fullUrl = `${config.authUrl}?${params.toString()}`;

    return new Promise<OAuthTokens>((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 600,
        height: 700,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      authWindow.loadURL(fullUrl);

      authWindow.webContents.on('will-redirect', async (_event, url) => {
        if (url.startsWith(config.callbackUrl)) {
          const code = new URL(url).searchParams.get('code');
          if (!code) {
            reject(new Error('No authorization code received'));
            authWindow.close();
            return;
          }
          try {
            const tokens = await this.exchangeToken(config, code);
            resolve(tokens);
          } catch (err) {
            reject(err);
          }
          authWindow.close();
        }
      });

      authWindow.on('closed', () => {
        reject(new Error('Authorization window closed by user'));
      });
    });
  }

  private async exchangeToken(config: OAuthConfig, code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.callbackUrl,
      client_id: config.clientId,
    });
    if (config.clientSecret) {
      body.set('client_secret', config.clientSecret);
    }

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    };
  }
}

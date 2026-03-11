/**
 * JWT authentication for JoWork Gateway.
 * Supports two modes:
 *   1. Direct JWT token (JOWORK_TOKEN env)
 *   2. Username/password → POST /api/auth/local → JWT
 */

interface AuthConfig {
  gatewayUrl: string;
  token?: string;
  username?: string;
  password?: string;
}

export class Auth {
  private jwt: string = '';
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
    if (config.token) {
      this.jwt = config.token;
    }
  }

  /** Get current JWT, fetching from Gateway if needed */
  async getToken(): Promise<string> {
    if (this.jwt) return this.jwt;

    if (!this.config.username) {
      throw new Error(
        'No JOWORK_TOKEN or JOWORK_USERNAME provided. ' +
        'Set JOWORK_TOKEN=<jwt> or JOWORK_USERNAME + JOWORK_PASSWORD in environment.'
      );
    }

    await this.fetchToken();
    return this.jwt;
  }

  /** Refresh JWT (called on 401) */
  async refresh(): Promise<string | null> {
    if (!this.config.username) return null;
    await this.fetchToken();
    return this.jwt;
  }

  private async fetchToken(): Promise<void> {
    const res = await fetch(`${this.config.gatewayUrl}/api/auth/local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.config.username,
        display_name: this.config.username,
        ...(this.config.password ? { password: this.config.password } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Auth failed (${res.status}): ${text}`);
    }

    const data = await res.json() as { token: string };
    if (!data.token) throw new Error('Auth response missing token');
    this.jwt = data.token;
  }
}

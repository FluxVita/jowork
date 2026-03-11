/**
 * HTTP client for JoWork Gateway Edge API.
 * Handles session lifecycle, tool discovery, and tool execution.
 */

import { Auth } from './auth.js';

const FETCH_TIMEOUT = 60_000;

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface SessionResponse {
  session_id: string;
  created: boolean;
}

export class GatewayClient {
  private baseUrl: string;
  private auth: Auth;
  private sessionId: string = '';
  private toolsCache: ToolDef[] | null = null;

  constructor(baseUrl: string, auth: Auth) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.auth = auth;
  }

  /** Connect to Gateway: verify health + create session */
  async connect(): Promise<void> {
    await this.health();
    await this.ensureSession();
    log('Connected', `session=${this.sessionId}`);
  }

  /** Check Gateway health */
  async health(): Promise<{ ok: boolean; version?: string }> {
    const res = await this.fetch('/health', { method: 'GET', noAuth: true });
    return res.json();
  }

  /** List remote tools (cached per session) */
  async listTools(): Promise<ToolDef[]> {
    if (this.toolsCache) return this.toolsCache;

    const res = await this.fetch('/api/edge/tools');
    if (!res.ok) {
      log('Warning', `tools list failed: ${res.status}`);
      return [];
    }

    const data = await res.json() as ToolDef[] | { tools: ToolDef[] };
    this.toolsCache = Array.isArray(data) ? data : data.tools ?? [];
    return this.toolsCache;
  }

  /** Invalidate tools cache (for reconnection) */
  clearToolsCache(): void {
    this.toolsCache = null;
  }

  /** Execute a remote tool */
  async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const res = await this.fetch('/api/edge/tool', {
      method: 'POST',
      body: { name, input, session_id: this.sessionId },
    });

    // Session expired → rebuild and retry once
    if (res.status === 403) {
      const data = await res.json() as { error?: string };
      if (data.error === 'Invalid session') {
        await this.ensureSession();
        return this.executeTool(name, input);
      }
      throw new Error(data.error || 'Permission denied');
    }

    const data = await res.json() as { result?: unknown; error?: string };
    if (!res.ok) throw new Error(data.error || `Tool ${name} failed (${res.status})`);

    return typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
  }

  /** Create or rebuild an Edge session */
  private async ensureSession(): Promise<void> {
    const res = await this.fetch('/api/edge/session', {
      method: 'POST',
      body: { title: 'MCP Server session' },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to create session (${res.status}): ${text}`);
    }

    const data = await res.json() as SessionResponse;
    this.sessionId = data.session_id;
  }

  /** Internal fetch wrapper with JWT injection and timeout */
  private async fetch(
    path: string,
    opts: { method?: string; body?: unknown; noAuth?: boolean } = {}
  ): Promise<Response> {
    const { method = 'GET', body, noAuth } = opts;
    const headers: Record<string, string> = {};

    if (!noAuth) {
      const token = await this.auth.getToken();
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });

    // JWT expired → try refresh
    if (res.status === 401 && !noAuth) {
      const newToken = await this.auth.refresh();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        return fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
      }
      log('Error', 'JWT expired. Update JOWORK_TOKEN or configure JOWORK_USERNAME/PASSWORD.');
    }

    return res;
  }
}

/** Log to stderr (MCP servers must not write to stdout) */
function log(level: string, ...args: unknown[]): void {
  process.stderr.write(`[jowork-mcp] [${level}] ${args.join(' ')}\n`);
}

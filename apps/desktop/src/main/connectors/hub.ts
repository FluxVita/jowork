import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CredentialStore } from './credential-store';
import { OAuthFlow, type OAuthConfig, type OAuthTokens } from './oauth-flow';
import type { HistoryManager } from '../engine/history';

export interface ConnectorManifest {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: 'code' | 'design' | 'communication' | 'docs' | 'local' | 'analytics';
  tier: 'ga' | 'beta' | 'planned';
  transport: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
  oauth?: OAuthConfig;
  configSchema?: Record<string, unknown>;
}

export interface NamespacedTool {
  connectorId: string;
  name: string;
  namespacedName: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface HealthStatus {
  connectorId: string;
  status: 'healthy' | 'unhealthy' | 'stopped';
  lastCheck: number;
  error?: string;
}

/**
 * ConnectorHub — single entry point for managing MCP-based connectors.
 * Handles lifecycle, OAuth, credential storage, and tool routing.
 */
export class ConnectorHub {
  private clients = new Map<string, Client>();
  private transports = new Map<string, StdioClientTransport>();
  private manifests = new Map<string, ConnectorManifest>();
  private credentials: CredentialStore;
  private oauthFlow: OAuthFlow;

  constructor(private historyManager: HistoryManager) {
    this.credentials = new CredentialStore();
    this.oauthFlow = new OAuthFlow();
    this.registerBuiltinManifests();
  }

  private registerBuiltinManifests(): void {
    const builtins: ConnectorManifest[] = [
      {
        id: 'github',
        name: 'GitHub',
        description: 'Repositories, issues, pull requests',
        category: 'code',
        tier: 'ga',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
      },
      {
        id: 'gitlab',
        name: 'GitLab',
        description: 'Projects, merge requests, issues',
        category: 'code',
        tier: 'ga',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-gitlab'],
        env: { GITLAB_PERSONAL_ACCESS_TOKEN: '' },
      },
      {
        id: 'figma',
        name: 'Figma',
        description: 'Design files and components',
        category: 'design',
        tier: 'ga',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@anthropic-ai/figma-mcp'],
        env: { FIGMA_ACCESS_TOKEN: '' },
      },
      {
        id: 'local-files',
        name: 'Local Files',
        description: 'Local project folders',
        category: 'local',
        tier: 'ga',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: {},
      },
    ];

    for (const m of builtins) {
      this.manifests.set(m.id, m);
    }
  }

  getManifests(): ConnectorManifest[] {
    return Array.from(this.manifests.values());
  }

  getManifest(id: string): ConnectorManifest | undefined {
    return this.manifests.get(id);
  }

  async authorize(connectorId: string): Promise<OAuthTokens | null> {
    const manifest = this.manifests.get(connectorId);
    if (!manifest?.oauth) return null;
    const tokens = await this.oauthFlow.authorize(manifest.oauth);
    this.credentials.save(connectorId, tokens);
    return tokens;
  }

  saveCredential(connectorId: string, credential: unknown): void {
    this.credentials.save(connectorId, credential);
  }

  hasCredential(connectorId: string): boolean {
    return this.credentials.has(connectorId);
  }

  async start(connectorId: string): Promise<void> {
    if (this.clients.has(connectorId)) return;

    const manifest = this.manifests.get(connectorId);
    if (!manifest) throw new Error(`Unknown connector: ${connectorId}`);

    // Build env with credentials
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (manifest.env) {
      const creds = this.credentials.get(connectorId) as Record<string, string> | null;
      for (const [key, defaultVal] of Object.entries(manifest.env)) {
        env[key] = creds?.[key] ?? creds?.accessToken ?? defaultVal;
      }
    }

    const transport = new StdioClientTransport({
      command: manifest.command,
      args: manifest.args,
      env,
    });

    const client = new Client({ name: 'jowork', version: '0.0.1' }, {});
    await client.connect(transport);

    this.clients.set(connectorId, client);
    this.transports.set(connectorId, transport);
  }

  async stop(connectorId: string): Promise<void> {
    const client = this.clients.get(connectorId);
    if (client) {
      await client.close();
      this.clients.delete(connectorId);
    }
    const transport = this.transports.get(connectorId);
    if (transport) {
      await transport.close();
      this.transports.delete(connectorId);
    }
  }

  async listAllTools(): Promise<NamespacedTool[]> {
    const allTools: NamespacedTool[] = [];

    for (const [connectorId, client] of this.clients) {
      try {
        const { tools } = await client.listTools();
        for (const tool of tools) {
          allTools.push({
            connectorId,
            name: tool.name,
            namespacedName: `${connectorId}/${tool.name}`,
            description: tool.description,
            inputSchema: tool.inputSchema as Record<string, unknown>,
          });
        }
      } catch {
        // skip failed connectors
      }
    }

    return allTools;
  }

  async callTool(namespacedName: string, args: Record<string, unknown>): Promise<unknown> {
    const [connectorId, toolName] = namespacedName.split('/');
    const client = this.clients.get(connectorId);
    if (!client) throw new Error(`Connector not started: ${connectorId}`);

    const result = await client.callTool({ name: toolName, arguments: args });
    return result;
  }

  async healthCheck(): Promise<Map<string, HealthStatus>> {
    const results = new Map<string, HealthStatus>();

    for (const [id] of this.manifests) {
      const client = this.clients.get(id);
      if (!client) {
        results.set(id, { connectorId: id, status: 'stopped', lastCheck: Date.now() });
        continue;
      }

      try {
        await client.listTools(); // lightweight ping
        results.set(id, { connectorId: id, status: 'healthy', lastCheck: Date.now() });
      } catch (err) {
        results.set(id, {
          connectorId: id,
          status: 'unhealthy',
          lastCheck: Date.now(),
          error: String(err),
        });
      }
    }

    return results;
  }

  async stopAll(): Promise<void> {
    for (const id of this.clients.keys()) {
      await this.stop(id);
    }
  }
}

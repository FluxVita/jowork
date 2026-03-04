// @jowork/core/connectors/protocol — Jowork Connect Protocol (JCP)
//
// Standard interface all Connectors must implement (§9.4).
// Third-party connectors are npm packages that export a JoworkConnector.

export type ConnectorAuthType = 'oauth2' | 'api_token' | 'api_key' | 'mcp' | 'none';
export type ConnectorCapabilityName = 'discover' | 'fetch' | 'search' | 'write' | 'subscribe';

// ─── Manifest ─────────────────────────────────────────────────────────────────

export interface ConnectorManifest {
  /** Unique identifier — must match npm package name convention, e.g. "github" */
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  /** Auth method required to connect */
  authType: ConnectorAuthType;
  capabilities: ConnectorCapabilityName[];
  /** JSON-schema for connector-specific settings (org, base_url, etc.) */
  configSchema?: Record<string, unknown>;
}

// ─── Credentials (opaque at protocol level) ───────────────────────────────────

export interface ConnectorCredentials {
  /** Encrypted blob — opaque to protocol, decrypted inside connector */
  encrypted?: string;
  /** Raw key/token for dev/testing — should not be used in production */
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

// ─── Data types ───────────────────────────────────────────────────────────────

export interface DataObject {
  /** Globally unique URI within this connector, e.g. "github:repo:owner/name" */
  uri: string;
  /** Human-readable name */
  name: string;
  kind: string;
  url?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface FetchedContent {
  uri: string;
  title: string;
  content: string;
  contentType: string;
  url?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface DiscoverPage {
  objects: DataObject[];
  /** Pass to next discover() call for pagination */
  nextCursor?: string;
}

export interface WriteResult {
  success: boolean;
  uri?: string;
  error?: string;
}

export interface ConnectorEvent {
  type: string;
  uri: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface Subscription {
  id: string;
  unsubscribe(): Promise<void>;
}

export interface HealthResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

// ─── JCP Connector interface ──────────────────────────────────────────────────

export interface JoworkConnector {
  // Metadata
  readonly manifest: ConnectorManifest;

  // Lifecycle
  initialize(config: Record<string, unknown>, credentials: ConnectorCredentials): Promise<void>;
  shutdown(): Promise<void>;
  health(): Promise<HealthResult>;

  // Data access (required)
  discover(cursor?: string): Promise<DiscoverPage>;
  fetch(uri: string): Promise<FetchedContent>;

  // Optional capabilities
  search?(query: string, limit?: number): Promise<FetchedContent[]>;
  write?(uri: string, content: string): Promise<WriteResult>;
  subscribe?(eventType: string, callback: (event: ConnectorEvent) => void): Promise<Subscription>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const jcpRegistry = new Map<string, JoworkConnector>();

export function registerJCPConnector(connector: JoworkConnector): void {
  jcpRegistry.set(connector.manifest.id, connector);
}

export function getJCPConnector(id: string): JoworkConnector | undefined {
  return jcpRegistry.get(id);
}

export function listJCPConnectors(): ConnectorManifest[] {
  return Array.from(jcpRegistry.values()).map(c => c.manifest);
}

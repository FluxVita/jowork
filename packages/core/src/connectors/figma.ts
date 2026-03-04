// @jowork/core/connectors/figma — Figma connector (JCP implementation)
//
// Connects to Figma: files, pages, components, frames.
// Uses Figma REST API v1 (no SDK dependency).
// Auth: Personal Access Token (from Figma → Account → Personal access tokens).

import type {
  JoworkConnector,
  ConnectorManifest,
  ConnectorCredentials,
  DiscoverPage,
  DataObject,
  FetchedContent,
  HealthResult,
} from './protocol.js';

interface FigmaProject {
  id: string;
  name: string;
}

interface FigmaFile {
  key: string;
  name: string;
  thumbnail_url?: string;
  last_modified: string;
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  description?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
}

interface FigmaFileResponse {
  name: string;
  lastModified: string;
  document: FigmaNode;
  components: Record<string, { name: string; description: string }>;
}

class FigmaConnector implements JoworkConnector {
  // Figma files are internal design assets
  readonly defaultSensitivity = 'internal' as const;

  readonly manifest: ConnectorManifest = {
    id: 'figma',
    name: 'Figma',
    version: '0.1.0',
    description: 'Connect to Figma files, pages, frames, and components',
    authType: 'api_token',
    capabilities: ['discover', 'fetch', 'search'],
    configSchema: {
      type: 'object',
      properties: {
        teamId: {
          type: 'string',
          title: 'Team ID',
          description: 'Figma team ID (from the URL when viewing a team page). Required to list projects.',
        },
        fileKeys: {
          type: 'array',
          items: { type: 'string' },
          title: 'File Keys',
          description: 'Specific Figma file keys to sync (optional — uses teamId otherwise)',
        },
      },
    },
  };

  private token    = '';
  private teamId   = '';
  private fileKeys: string[] = [];
  private apiUrl   = 'https://api.figma.com/v1';

  async initialize(config: Record<string, unknown>, credentials: ConnectorCredentials): Promise<void> {
    this.token    = credentials.apiKey ?? credentials.accessToken ?? '';
    this.teamId   = (config['teamId'] as string) ?? '';
    this.fileKeys = (config['fileKeys'] as string[] | undefined) ?? [];
  }

  async shutdown(): Promise<void> {
    this.token = '';
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const res = await this.get('/me');
      if (!res.ok) return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }

  async discover(_cursor?: string): Promise<DiscoverPage> {
    // If specific file keys are configured, return them directly
    if (this.fileKeys.length > 0) {
      const objects: DataObject[] = this.fileKeys.map(key => ({
        uri:  `figma:file:${key}`,
        name: key,
        kind: 'file',
        url:  `https://www.figma.com/file/${key}`,
      }));
      return { objects };
    }

    // Otherwise list projects via teamId, then collect files
    if (!this.teamId) {
      return { objects: [] };
    }

    const projRes  = await this.get(`/teams/${this.teamId}/projects`);
    if (!projRes.ok) throw new Error(`Figma projects list error: HTTP ${projRes.status}`);

    const { projects } = await projRes.json() as { projects: FigmaProject[] };

    // For each project, list files (up to first 3 projects to avoid rate limits)
    const files: FigmaFile[] = [];
    for (const proj of projects.slice(0, 3)) {
      const filesRes = await this.get(`/projects/${proj.id}/files`);
      if (!filesRes.ok) continue;
      const { files: pFiles } = await filesRes.json() as { files: FigmaFile[] };
      files.push(...pFiles);
    }

    const objects: DataObject[] = files.map(f => ({
      uri:      `figma:file:${f.key}`,
      name:     f.name,
      kind:     'file',
      url:      `https://www.figma.com/file/${f.key}`,
      updatedAt: f.last_modified,
    }));

    return { objects };
  }

  async fetch(uri: string): Promise<FetchedContent> {
    const [, type, ...rest] = uri.split(':');
    const ref = rest.join(':');

    if (type === 'file')      return this.fetchFile(ref ?? '');
    if (type === 'component') return this.fetchComponent(ref ?? '');

    throw new Error(`Unknown Figma URI type: ${type}`);
  }

  async search(query: string, limit = 10): Promise<FetchedContent[]> {
    // Figma doesn't have a native text search API — search within discovered files
    // We search component names in the configured files
    if (this.fileKeys.length === 0 && !this.teamId) return [];

    const results: FetchedContent[] = [];
    const queryLower = query.toLowerCase();

    for (const key of this.fileKeys.slice(0, 3)) {
      const res = await this.get(`/files/${key}/components`);
      if (!res.ok) continue;

      const data = await res.json() as { meta: { components: Array<{ key: string; name: string; description: string; file_key: string }> } };
      const matching = data.meta.components
        .filter(c => c.name.toLowerCase().includes(queryLower) || c.description.toLowerCase().includes(queryLower))
        .slice(0, limit - results.length);

      for (const comp of matching) {
        results.push({
          uri:         `figma:component:${comp.file_key}:${comp.key}`,
          title:       comp.name,
          content:     comp.description || `Component: ${comp.name}`,
          contentType: 'text/plain',
          url:         `https://www.figma.com/file/${comp.file_key}?node-id=${encodeURIComponent(comp.key)}`,
        });
      }

      if (results.length >= limit) break;
    }

    return results.slice(0, limit);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchFile(key: string): Promise<FetchedContent> {
    const res = await this.get(`/files/${key}?depth=2`);
    if (!res.ok) throw new Error(`Figma file fetch error: HTTP ${res.status}`);

    const file = await res.json() as FigmaFileResponse;

    // Summarize top-level pages and components
    const pages = (file.document.children ?? [])
      .filter(n => n.type === 'CANVAS')
      .map(n => `- ${n.name}`);

    const componentCount = Object.keys(file.components).length;

    const content = [
      `**File**: ${file.name}`,
      `**Last modified**: ${file.lastModified}`,
      `**Pages** (${pages.length}):`,
      ...pages,
      '',
      `**Components**: ${componentCount} total`,
    ].join('\n');

    return {
      uri:         `figma:file:${key}`,
      title:       file.name,
      content,
      contentType: 'text/markdown',
      url:         `https://www.figma.com/file/${key}`,
      updatedAt:   file.lastModified,
    };
  }

  private async fetchComponent(ref: string): Promise<FetchedContent> {
    // ref: "fileKey:componentKey"
    const [fileKey, componentKey] = ref.split(':');
    const res = await this.get(`/files/${fileKey}/nodes?ids=${componentKey}`);
    if (!res.ok) throw new Error(`Figma component fetch error: HTTP ${res.status}`);

    const data = await res.json() as { nodes: Record<string, { document: FigmaNode }> };
    const node = data.nodes[componentKey ?? '']?.document;
    if (!node) throw new Error(`Figma component not found: ${ref}`);

    return {
      uri:         `figma:component:${ref}`,
      title:       node.name,
      content:     node.description ?? `Component: ${node.name}`,
      contentType: 'text/plain',
      url:         `https://www.figma.com/file/${fileKey}?node-id=${encodeURIComponent(componentKey ?? '')}`,
    };
  }

  private get(path: string): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      headers: { 'x-figma-token': this.token },
    });
  }
}

/** Singleton Figma connector — registered automatically via connectors/index.ts */
export const figmaConnector = new FigmaConnector();

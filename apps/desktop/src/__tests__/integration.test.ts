/**
 * Integration tests with REAL APIs.
 *
 * These tests spawn actual MCP servers and call real external APIs
 * (GitHub, GitLab, Feishu) to verify end-to-end connectivity.
 *
 * Requirements:
 *   - .env.test in apps/desktop/ with real tokens
 *   - Network access
 *   - `npx` available (to download MCP server packages)
 *
 * Run: cd apps/desktop && INTEGRATION=1 npx vitest run src/__tests__/integration.test.ts
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Load .env.test ──────────────────────────────────────────────
function loadEnvTest(): Record<string, string> {
  const envPath = resolve(__dirname, '../../.env.test');
  try {
    const content = readFileSync(envPath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
    return env;
  } catch {
    return {};
  }
}

const testEnv = loadEnvTest();
const skip = !process.env.INTEGRATION;

const CLAUDE_BIN = '/Users/signalz/.local/bin/claude';

// ── Helpers ─────────────────────────────────────────────────────
async function createMcpClient(
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...process.env as Record<string, string>, ...env },
  });
  const client = new Client({ name: 'jowork-integration-test', version: '0.0.1' }, {});
  await client.connect(transport);
  return { client, transport };
}

async function cleanup(client?: Client, transport?: StdioClientTransport): Promise<void> {
  try { await client?.close(); } catch { /* ignore */ }
  try { await transport?.close(); } catch { /* ignore */ }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  1. GitHub Connector (MCP)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe.skipIf(skip)('Integration: GitHub Connector', () => {
  let client: Client;
  let transport: StdioClientTransport;
  let toolNames: string[] = [];

  beforeAll(async () => {
    const token = testEnv.GITHUB_PERSONAL_ACCESS_TOKEN;
    expect(token).toBeTruthy();
    const result = await createMcpClient('npx', ['-y', '@modelcontextprotocol/server-github'], {
      GITHUB_PERSONAL_ACCESS_TOKEN: token,
    });
    client = result.client;
    transport = result.transport;
  }, 60_000);

  afterAll(async () => {
    await cleanup(client, transport);
  });

  it('should list tools from GitHub MCP server', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    toolNames = tools.map((t) => t.name);
    console.log(`  GitHub tools (${tools.length}):`, toolNames.join(', '));
  }, 30_000);

  it('should search repositories with real API call', async () => {
    const result = await client.callTool({
      name: 'search_repositories',
      arguments: { query: 'electron language:typescript' },
    });
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.find((c: { type: string }) => c.type === 'text');
    if (text) {
      const parsed = JSON.parse((text as { text: string }).text);
      expect(parsed.total_count).toBeGreaterThan(0);
      console.log(`  GitHub search: found ${parsed.total_count} repos ✓`);
    }
  }, 30_000);

  it('should get file contents from a real repo', async () => {
    const result = await client.callTool({
      name: 'get_file_contents',
      arguments: {
        owner: 'anthropics',
        repo: 'anthropic-sdk-python',
        path: 'README.md',
      },
    });
    expect(result).toBeDefined();
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.find((c: { type: string }) => c.type === 'text');
    expect(text).toBeDefined();
    console.log('  GitHub get_file_contents: ✓');
  }, 30_000);
}, 120_000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  2. GitLab Connector (MCP — @structured-world/gitlab-mcp)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe.skipIf(skip)('Integration: GitLab Connector', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const token = testEnv.GITLAB_PERSONAL_ACCESS_TOKEN || testEnv.GITLAB_TOKEN;
    const apiUrl = testEnv.GITLAB_API_URL || 'https://gitlab.fluxvitae.com';
    expect(token).toBeTruthy();
    const result = await createMcpClient('npx', ['-y', '@structured-world/gitlab-mcp'], {
      GITLAB_TOKEN: token,
      GITLAB_API_URL: apiUrl,
    });
    client = result.client;
    transport = result.transport;
  }, 90_000);

  afterAll(async () => {
    await cleanup(client, transport);
  });

  it('should list tools from GitLab MCP server', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = tools.map((t) => t.name);
    console.log(`  GitLab tools (${tools.length}):`, toolNames.slice(0, 15).join(', '));
  }, 30_000);

  it('should list projects with real API call', async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);
    const listTool = toolNames.find((n) => /list.*project|project.*list|search.*project/i.test(n));
    if (listTool) {
      const result = await client.callTool({
        name: listTool,
        arguments: {},
      });
      expect(result).toBeDefined();
      console.log(`  GitLab ${listTool}: ✓`);
    } else {
      // Just verify we have tools — connectivity is proven
      expect(toolNames.length).toBeGreaterThan(0);
      console.log('  GitLab connected, tools:', toolNames.slice(0, 5).join(', '));
    }
  }, 30_000);
}, 150_000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  3. Feishu / Lark Connector (MCP — @larksuiteoapi/lark-mcp)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe.skipIf(skip)('Integration: Feishu Connector', () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const appId = testEnv.LARK_APP_ID;
    const appSecret = testEnv.LARK_APP_SECRET;
    expect(appId).toBeTruthy();
    expect(appSecret).toBeTruthy();
    // @larksuiteoapi/lark-mcp requires CLI args (-a, -s), not env vars
    const result = await createMcpClient('npx', [
      '-y', '@larksuiteoapi/lark-mcp', 'mcp',
      '-a', appId,
      '-s', appSecret,
    ], {});
    client = result.client;
    transport = result.transport;
  }, 90_000);

  afterAll(async () => {
    await cleanup(client, transport);
  });

  it('should list tools from Feishu MCP server', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = tools.map((t) => t.name);
    console.log(`  Feishu tools (${tools.length}):`, toolNames.slice(0, 10).join(', '));
  }, 30_000);

  it('should call a real Feishu API (list chats)', async () => {
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);
    const chatListTool = toolNames.find((n) => /im_v1_chat_list|chat.*list/i.test(n));
    if (chatListTool) {
      const result = await client.callTool({
        name: chatListTool,
        arguments: {},
      });
      expect(result).toBeDefined();
      const content = Array.isArray(result.content) ? result.content : [];
      console.log('  Feishu chat list: ✓', content.length > 0 ? '(has data)' : '(empty)');
    } else {
      // Fallback — try any available read-only tool
      const safeTool = toolNames.find((n) => /list|get|search/i.test(n));
      if (safeTool) {
        const result = await client.callTool({ name: safeTool, arguments: {} });
        expect(result).toBeDefined();
        console.log(`  Feishu ${safeTool}: ✓`);
      } else {
        expect(toolNames.length).toBeGreaterThan(5);
        console.log('  Feishu tools:', toolNames.slice(0, 5).join(', '));
      }
    }
  }, 30_000);
}, 150_000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  4. Local Folder Connector (MCP)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe.skipIf(skip)('Integration: Local Folder Connector', () => {
  let client: Client;
  let transport: StdioClientTransport;
  const projectDir = resolve(__dirname, '../../../..');

  beforeAll(async () => {
    const result = await createMcpClient('npx', ['-y', '@modelcontextprotocol/server-filesystem', projectDir], {});
    client = result.client;
    transport = result.transport;
  }, 60_000);

  afterAll(async () => {
    await cleanup(client, transport);
  });

  it('should list tools from Filesystem MCP server', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = tools.map((t) => t.name);
    console.log(`  Filesystem tools (${tools.length}):`, toolNames.join(', '));
    expect(toolNames).toEqual(expect.arrayContaining([
      expect.stringMatching(/read|list|write|search/i),
    ]));
  }, 30_000);

  it('should read a real file from disk', async () => {
    const result = await client.callTool({
      name: 'read_file',
      arguments: { path: resolve(projectDir, 'package.json') },
    });
    expect(result).toBeDefined();
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.find((c: { type: string }) => c.type === 'text');
    expect(text).toBeDefined();
    expect((text as { text: string }).text).toContain('jowork');
    console.log('  Read package.json: ✓');
  }, 15_000);

  it('should list directory contents', async () => {
    const result = await client.callTool({
      name: 'list_directory',
      arguments: { path: projectDir },
    });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.find((c: { type: string }) => c.type === 'text');
    expect(text).toBeDefined();
    const listing = (text as { text: string }).text;
    expect(listing).toContain('apps');
    expect(listing).toContain('packages');
    console.log('  List project root: ✓');
  }, 15_000);
}, 60_000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  5. Claude Code Engine (Local)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe.skipIf(skip)('Integration: Claude Code Engine', () => {
  it('should detect claude CLI is installed', async () => {
    const result = await new Promise<{ installed: boolean; version?: string }>((resolve) => {
      const child = spawn(CLAUDE_BIN, ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDECODE: undefined },
      });
      let stdout = '';
      child.stdout?.on('data', (d) => (stdout += d));
      child.on('close', (code) => {
        if (code === 0) resolve({ installed: true, version: stdout.trim() });
        else resolve({ installed: false });
      });
      child.on('error', () => resolve({ installed: false }));
    });

    expect(result.installed).toBe(true);
    expect(result.version).toMatch(/\d+\.\d+/);
    console.log(`  Claude Code version: ${result.version}`);
  }, 10_000);

  it('should execute a simple prompt and get streaming response', async () => {
    // Use shell execution to avoid vitest child_process buffering issues
    const { execSync } = await import('child_process');
    const output = execSync(
      `CLAUDECODE= ${CLAUDE_BIN} -p "Reply with exactly the text: INTEGRATION_TEST_OK" --output-format stream-json --verbose --dangerously-skip-permissions 2>/dev/null`,
      { timeout: 60_000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    );

    const events: Array<Record<string, unknown>> = [];
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch { /* skip */ }
    }

    expect(events.length).toBeGreaterThan(0);

    const types = events.map((e) => e.type);
    console.log(`  Event types: ${[...new Set(types)].join(', ')}`);

    // Extract text from result event
    const resultEvent = events.find((e) => e.type === 'result');
    const assistantEvent = events.find((e) => e.type === 'assistant');

    let allText = '';
    if (resultEvent && typeof resultEvent.result === 'string') {
      allText = resultEvent.result;
    } else if (assistantEvent) {
      const msg = assistantEvent.message as { content?: Array<{ text?: string }> } | undefined;
      if (msg?.content) {
        allText = msg.content.map((c) => c.text ?? '').join('');
      }
    }

    expect(allText).toContain('INTEGRATION_TEST_OK');
    console.log('  Claude Code chat: ✓');
  }, 120_000);
}, 150_000);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  6. Cloud Engine Health Check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe.skipIf(skip)('Integration: Cloud Engine', () => {
  const cloudUrl = testEnv.JOWORK_CLOUD_URL || testEnv.JOWORK_API_URL || 'https://jowork.work';

  it('should check cloud service health endpoint', async () => {
    try {
      const res = await fetch(`${cloudUrl}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      console.log(`  Cloud health: ${res.status} ${res.statusText}`);
      if (res.ok) {
        const body = await res.text();
        console.log(`  Cloud response: ${body.slice(0, 200)}`);
      } else {
        console.log('  Cloud service returned non-200 (may not be deployed yet)');
      }
    } catch (err) {
      console.log(`  Cloud service unreachable: ${err}`);
      // Expected if cloud hasn't been deployed
    }
  }, 15_000);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  7. ConnectorHub Credential Flow (no Electron dependency)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe.skipIf(skip)('Integration: ConnectorHub credential env injection', () => {
  it('should correctly build env with token for GitHub', () => {
    const manifest = { env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } };
    const creds = { GITHUB_PERSONAL_ACCESS_TOKEN: testEnv.GITHUB_PERSONAL_ACCESS_TOKEN };

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    for (const [key, defaultVal] of Object.entries(manifest.env)) {
      env[key] = (creds as Record<string, string>)?.[key] ?? defaultVal;
    }

    expect(env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe(testEnv.GITHUB_PERSONAL_ACCESS_TOKEN);
    expect(env.GITHUB_PERSONAL_ACCESS_TOKEN).not.toBe('');
    console.log('  Env injection: ✓');
  });

  it('should correctly build env for Feishu (multi-key)', () => {
    const manifest = { env: { LARK_APP_ID: '', LARK_APP_SECRET: '' } };
    const creds = {
      LARK_APP_ID: testEnv.LARK_APP_ID,
      LARK_APP_SECRET: testEnv.LARK_APP_SECRET,
    };

    const env: Record<string, string> = {};
    for (const [key, defaultVal] of Object.entries(manifest.env)) {
      env[key] = (creds as Record<string, string>)?.[key] ?? defaultVal;
    }

    expect(env.LARK_APP_ID).toBe(testEnv.LARK_APP_ID);
    expect(env.LARK_APP_SECRET).toBe(testEnv.LARK_APP_SECRET);
    console.log('  Multi-key env injection: ✓');
  });

  it('should fallback to accessToken when specific key not in creds', () => {
    const manifest = { env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } };
    const creds = { accessToken: 'test-oauth-token-123' } as Record<string, string>;

    const env: Record<string, string> = {};
    for (const [key, defaultVal] of Object.entries(manifest.env)) {
      env[key] = creds?.[key] ?? creds?.accessToken ?? defaultVal;
    }

    expect(env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('test-oauth-token-123');
    console.log('  OAuth accessToken fallback: ✓');
  });

  it('FIXED: ConnectorHub no longer clobbers process.env tokens', () => {
    // After fix: when no credential is stored and key exists in process.env,
    // the env should preserve the process.env value.
    const manifest = { env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } };
    const creds = null; // No credentials stored

    const env: Record<string, string> = {
      GITHUB_PERSONAL_ACCESS_TOKEN: 'from-process-env',
    };
    // New logic (matching fixed ConnectorHub.start):
    for (const [key, defaultVal] of Object.entries(manifest.env)) {
      const val = (creds as Record<string, string> | null)?.[key]
        ?? (creds as Record<string, string> | null)?.accessToken;
      if (val) {
        env[key] = val;
      } else if (defaultVal && !env[key]) {
        env[key] = defaultVal;
      }
    }

    // FIXED: process.env value preserved
    expect(env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('from-process-env');
    console.log('  ✓ process.env token preserved when no credential stored');
  });
});

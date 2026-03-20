import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DbManager } from '../db/manager.js';

/**
 * MCP Integration Test — spawns the MCP server as a subprocess
 * and sends JSON-RPC requests over stdio, verifying responses.
 */
describe('MCP Server Integration', () => {
  let tempDir: string;
  let dbFile: string;
  let child: ChildProcess;
  let responseBuffer = '';

  function sendRequest(request: object): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MCP response timeout')), 5000);
      const msg = JSON.stringify(request) + '\n';

      const handler = (data: Buffer) => {
        responseBuffer += data.toString();
        // Try to parse each line as JSON
        const lines = responseBuffer.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === (request as { id: number }).id) {
              clearTimeout(timeout);
              child.stdout?.off('data', handler);
              responseBuffer = '';
              resolve(parsed);
              return;
            }
          } catch { /* not complete JSON yet */ }
        }
      };

      child.stdout?.on('data', handler);
      child.stdin?.write(msg);
    });
  }

  beforeAll(async () => {
    // Setup: create temp DB
    tempDir = mkdtempSync(join(tmpdir(), 'jowork-mcp-test-'));
    dbFile = join(tempDir, 'test.db');
    const db = new DbManager(dbFile);
    db.ensureTables();
    // Insert test data
    const sqlite = db.getSqlite();
    const now = Date.now();
    sqlite.prepare(`
      INSERT INTO objects (id, source, source_type, uri, title, summary, content_hash, last_synced_at, created_at)
      VALUES ('obj_test1', 'test', 'message', 'test://msg/1', 'Test Group', 'Hello world test message', 'hash1', ?, ?)
    `).run(now, now);
    sqlite.prepare(`
      INSERT INTO object_bodies (object_id, content, content_type, fetched_at)
      VALUES ('obj_test1', 'Hello world test message full content', 'text/plain', ?)
    `).run(now);
    // Rebuild FTS
    try { sqlite.exec(`INSERT INTO objects_fts(objects_fts) VALUES('rebuild')`); } catch { /* */ }
    db.close();

    // Spawn MCP server with custom DB path
    const cliPath = join(import.meta.dirname, '..', '..', 'dist', 'cli.js');
    child = spawn('node', [cliPath, 'serve'], {
      env: { ...process.env, JOWORK_DB_PATH: dbFile, I18NEXT_DISABLE_BANNER: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for process to start
    await new Promise(resolve => setTimeout(resolve, 500));

    // Initialize MCP
    const initRes = await sendRequest({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.1' },
      },
    });
    expect(initRes.result).toBeDefined();
  }, 10000);

  afterAll(() => {
    child?.kill();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('lists tools via tools/list', async () => {
    const res = await sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    const tools = (res.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map(t => t.name);
    expect(names).toContain('search_data');
    expect(names).toContain('read_memory');
    expect(names).toContain('write_memory');
    expect(names).toContain('search_memory');
    expect(names).toContain('get_environment');
    // Should NOT contain removed tools
    expect(names).not.toContain('notify');
    expect(names).not.toContain('list_tasks');
  });

  it('calls get_environment tool', async () => {
    const res = await sendRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'get_environment',
        arguments: {},
      },
    });
    const result = res.result as { content: Array<{ type: string; text: string }> };
    expect(result.content[0].type).toBe('text');
    const env = JSON.parse(result.content[0].text);
    expect(env.platform).toBeDefined();
    expect(env.nodeVersion).toBeDefined();
  });

  it('calls write_memory and read_memory roundtrip', async () => {
    // Write
    const writeRes = await sendRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'write_memory',
        arguments: {
          title: 'MCP Test Memory',
          content: 'This was written via MCP integration test',
          tags: ['test', 'mcp'],
        },
      },
    });
    const writeResult = writeRes.result as { content: Array<{ text: string }> };
    expect(writeResult.content[0].text).toContain('Memory saved');

    // Read
    const readRes = await sendRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'read_memory',
        arguments: { query: 'MCP Test', limit: 5 },
      },
    });
    const readResult = readRes.result as { content: Array<{ text: string }> };
    const memories = JSON.parse(readResult.content[0].text);
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].title).toBe('MCP Test Memory');
  });
});

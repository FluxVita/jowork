// Tests for Phase 61: Geek Mode — Basic Terminal
// Tests execInSession, getSessionInfo, resetSession, listSessions, and the REST router.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import http from 'node:http';
import express from 'express';

import {
  execInSession,
  getSessionInfo,
  resetSession,
  listSessions,
  removeSession,
} from '../terminal/index.js';
import { terminalRouter } from '../gateway/routes/terminal.js';

// ─── Terminal module tests ──────────────────────────────────────────────────

describe('Terminal — execInSession', () => {
  beforeEach(() => {
    // Cleanup test sessions to avoid state leakage between tests
    removeSession('test-exec');
    removeSession('test-cd');
    removeSession('test-err');
    removeSession('test-timeout');
  });

  test('executes a simple echo command and returns stdout', async () => {
    const result = await execInSession('test-exec', 'echo hello');
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('hello'), `stdout: ${result.stdout}`);
    assert.equal(result.stderr, '');
  });

  test('captures exit code for failing commands', async () => {
    const result = await execInSession('test-err', 'exit 42', 5000);
    assert.equal(result.exitCode, 42);
  });

  test('captures stderr output', async () => {
    const result = await execInSession('test-exec', 'echo "err msg" >&2', 5000);
    assert.ok(result.stderr.includes('err msg'), `stderr: ${result.stderr}`);
  });

  test('cd command persists working directory for next command', async () => {
    const result1 = await execInSession('test-cd', 'cd /tmp');
    assert.equal(result1.exitCode, 0);
    // macOS: /tmp symlinks to /private/tmp — accept both
    assert.ok(result1.cwd.includes('tmp'), `Expected cwd to include 'tmp', got: ${result1.cwd}`);

    const result2 = await execInSession('test-cd', 'pwd');
    assert.ok(result2.stdout.trim().includes('tmp'), `Expected 'tmp' in stdout, got: ${result2.stdout}`);
  });

  test('returns home directory as initial cwd', async () => {
    const info = getSessionInfo('new-session-xyz');
    assert.equal(info.cwd, homedir());
    removeSession('new-session-xyz');
  });
});

describe('Terminal — session management', () => {
  beforeEach(() => {
    removeSession('sess-mgmt');
  });

  test('getSessionInfo creates session with home cwd', () => {
    const info = getSessionInfo('sess-mgmt');
    assert.equal(info.id, 'sess-mgmt');
    assert.equal(info.cwd, homedir());
    assert.ok(info.createdAt);
  });

  test('resetSession restores cwd to home', async () => {
    await execInSession('sess-mgmt', 'cd /tmp');
    const after = getSessionInfo('sess-mgmt');
    assert.equal(after.cwd, '/tmp');

    const reset = resetSession('sess-mgmt');
    assert.equal(reset.cwd, homedir());
  });

  test('listSessions includes active sessions', () => {
    getSessionInfo('sess-mgmt');
    const all = listSessions();
    assert.ok(all.some(s => s.id === 'sess-mgmt'), 'sess-mgmt not in list');
  });

  test('removeSession deletes the session', () => {
    getSessionInfo('sess-mgmt');
    const removed = removeSession('sess-mgmt');
    assert.ok(removed, 'Should return true when session existed');
    const all = listSessions();
    assert.ok(!all.some(s => s.id === 'sess-mgmt'), 'Session should be gone');
  });
});

// ─── Terminal REST router tests ──────────────────────────────────────────────

function buildApp() {
  process.env['JOWORK_MODE'] = 'personal';
  const app = express();
  app.use(express.json());
  app.use(terminalRouter());
  return app;
}

type JsonBody = Record<string, unknown>;

function jsonRequest(
  app: express.Express,
  method: string,
  path: string,
  body?: JsonBody,
): Promise<{ status: number; body: JsonBody }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      const payload = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: 'localhost',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          server.close();
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as JsonBody }); }
          catch { resolve({ status: res.statusCode ?? 0, body: {} }); }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

describe('Terminal router — POST /api/terminal/exec', () => {
  test('runs echo command and returns stdout', async () => {
    const { status, body } = await jsonRequest(buildApp(), 'POST', '/api/terminal/exec', { command: 'echo hi' });
    assert.equal(status, 200);
    assert.ok((body['stdout'] as string).includes('hi'), `stdout: ${body['stdout']}`);
    assert.equal(body['exitCode'], 0);
    assert.ok(body['cwd'], 'Should include cwd');
  });

  test('returns 400 for missing command', async () => {
    const { status } = await jsonRequest(buildApp(), 'POST', '/api/terminal/exec', {});
    assert.equal(status, 400);
  });

  test('GET /api/terminal returns session info', async () => {
    const { status, body } = await jsonRequest(buildApp(), 'GET', '/api/terminal', undefined);
    assert.equal(status, 200);
    assert.ok(body['cwd'], 'Should include cwd');
    assert.ok(body['id'], 'Should include id');
  });

  test('DELETE /api/terminal resets cwd to home', async () => {
    const { status, body } = await jsonRequest(buildApp(), 'DELETE', '/api/terminal', undefined);
    assert.equal(status, 200);
    assert.equal(body['cwd'], homedir(), `Expected homedir, got: ${body['cwd']}`);
  });
});

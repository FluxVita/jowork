// Tests for Phase 13 network module: mDNS encoder + tunnel state machine

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getLocalIp, getLocalIps } from '../network/mdns.js';
import { getTunnelState, stopTunnel } from '../network/tunnel.js';

// ─── mDNS helpers ─────────────────────────────────────────────────────────────

describe('getLocalIp', () => {
  test('returns a valid IPv4 address', () => {
    const ip = getLocalIp();
    assert.ok(/^\d+\.\d+\.\d+\.\d+$/.test(ip), `Expected IPv4, got: ${ip}`);
  });

  test('returns a string', () => {
    assert.equal(typeof getLocalIp(), 'string');
  });
});

describe('getLocalIps', () => {
  test('returns an array', () => {
    const ips = getLocalIps();
    assert.ok(Array.isArray(ips));
  });

  test('all entries are valid IPv4', () => {
    const ips = getLocalIps();
    for (const ip of ips) {
      assert.ok(/^\d+\.\d+\.\d+\.\d+$/.test(ip), `Invalid IP: ${ip}`);
    }
  });
});

// ─── Tunnel state machine ──────────────────────────────────────────────────────

describe('getTunnelState', () => {
  test('initial state is idle', () => {
    const state = getTunnelState();
    assert.equal(state.status, 'idle');
    assert.equal(state.url, null);
    assert.equal(state.error, null);
  });

  test('stopTunnel is safe to call when idle', () => {
    assert.doesNotThrow(() => stopTunnel());
    const state = getTunnelState();
    assert.equal(state.status, 'idle');
  });

  test('getTunnelState returns a copy (not mutable reference)', () => {
    const s1 = getTunnelState();
    const s2 = getTunnelState();
    assert.deepEqual(s1, s2);
    // Mutating s1 should not affect s2
    (s1 as { status: string }).status = 'active';
    assert.equal(getTunnelState().status, 'idle');
  });
});

// ─── startTunnel rejection (no cloudflared installed) ─────────────────────────

describe('startTunnel', () => {
  test('rejects if cloudflared is not in PATH', async () => {
    // Override PATH to ensure cloudflared is not found
    const origPath = process.env['PATH'];
    process.env['PATH'] = '/nonexistent-path';
    try {
      const { startTunnel } = await import('../network/tunnel.js');
      await assert.rejects(
        () => startTunnel(18800),
        (err: Error) => {
          assert.ok(err instanceof Error);
          return true;
        },
      );
    } finally {
      process.env['PATH'] = origPath;
      stopTunnel(); // ensure clean state
    }
  });
});
